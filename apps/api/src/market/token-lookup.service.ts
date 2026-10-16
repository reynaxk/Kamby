import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { EVM_USDC_BY_CHAIN_ID, pickSanePair, type MarketSummary } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, erc20Abi, getAddress, http, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../config/env';

/** DexScreener's chain ids for the chains Kamby trades on. */
const DEXSCREENER_EVM: Record<string, number> = { base: 8453, bsc: 56, robinhood: 4663 };
const GOPLUS_CHAIN: Record<number, string> = { 8453: '8453', 56: '56', 4663: '4663' };
/** Same bars the automatic listing uses (apps/workers aggregator-markets.ts), so a pasted
 *  address can't list a coin the lists would have refused. */
const MIN_LIQUIDITY_USD = 10_000;
const MAX_TAX = 0.1;
/** price_change_24h_pct is Decimal(12, 4) — a launch-price "change" can overflow it (see the workers' clampPct). */
function clampPct(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value) ? null : Math.max(-99_999_999, Math.min(99_999_999, value));
}
/** A miss is remembered briefly so one address pasted again and again isn't a call each time. */
const MISS_TTL_MS = 5 * 60_000;

export interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  info?: { imageUrl?: string };
}

interface GoPlusResult {
  is_honeypot?: string;
  cannot_sell_all?: string;
  buy_tax?: string;
  sell_tax?: string;
  transfer_pausable?: string;
  is_blacklisted?: string;
}

/** Exported for tests. The best pool listing `address` itself (not as the quote side), or null. */
export function bestOwnPair(pairs: readonly DexScreenerPair[], address: string, chain: (chainId: string) => boolean): DexScreenerPair | null {
  const own = pairs.filter((p) => p.chainId && chain(p.chainId) && p.baseToken?.address?.toLowerCase() === address.toLowerCase());
  return pickSanePair(own.map((p) => ({ pair: p, priceUsd: Number(p.priceUsd), liquidityUsd: p.liquidity?.usd ?? 0 })))?.pair ?? null;
}

/** Exported for tests. GoPlus flags that rule a coin out — no verdict also rules it out. */
export function unsafe(r: GoPlusResult | undefined): boolean {
  if (!r) return true;
  if (r.is_honeypot === '1' || r.cannot_sell_all === '1' || r.transfer_pausable === '1' || r.is_blacklisted === '1') return true;
  return Number(r.buy_tax || 0) > MAX_TAX || Number(r.sell_tax || 0) > MAX_TAX;
}

/**
 * Search by a coin's address finds coins Kamby doesn't list yet (owner 2026-10-16: "my dad
 * tried and he couldnt find"). Search only knew coins already in Kamby's lists; a pasted
 * address now falls back to DexScreener:
 *  - Solana: the coin is returned as-is — its page already loads any mint live.
 *  - Base / BNB / Robinhood: the coin is listed the same way the automatic discovery lists
 *    coins (an aggregator-priced market, re-priced by the workers every minute) — but only
 *    if it passes the same liquidity floor and GoPlus honeypot/tax check.
 */
@Injectable()
export class TokenLookupService {
  private readonly clients = new Map<number, PublicClient>();
  private readonly misses = new Map<string, number>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    for (const chain of getConfiguredChains((key) => config.get(key, { infer: true }))) {
      this.clients.set(chain.chainId, createPublicClient({ transport: http(chain.rpcUrl) }) as PublicClient);
    }
    this.logger.setContext('TokenLookupService');
  }

  /** Solana: a live summary. EVM: the id of the market it listed, for the caller to load. */
  async lookup(address: string): Promise<{ solana: MarketSummary } | { evmMarketId: string } | null> {
    const key = address.toLowerCase();
    const missedAt = this.misses.get(key);
    if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return null;
    const result = await this.find(address).catch((error: unknown) => {
      this.logger.warn({ err: error, address }, 'Token lookup failed');
      return null;
    });
    if (!result) {
      if (this.misses.size > 5_000) this.misses.clear();
      this.misses.set(key, Date.now());
    }
    return result;
  }

  private async find(address: string): Promise<{ solana: MarketSummary } | { evmMarketId: string } | null> {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const pairs = ((await res.json()) as { pairs?: DexScreenerPair[] | null }).pairs ?? [];
    if (address.startsWith('0x')) return this.listEvm(address, pairs);

    const pair = bestOwnPair(pairs, address, (c) => c === 'solana');
    if (!pair || (pair.liquidity?.usd ?? 0) <= 0) return null;
    return {
      solana: {
        chainIdentifier: 'solana',
        tokenAddress: address,
        symbol: pair.baseToken?.symbol ?? null,
        name: pair.baseToken?.name ?? null,
        decimals: null,
        logoUrl: pair.info?.imageUrl?.startsWith('https://') ? pair.info.imageUrl : null,
        quoteSymbol: pair.quoteToken?.symbol ?? null,
        quoteAddress: pair.quoteToken?.address ?? '',
        quoteDecimals: null,
        dex: pair.dexId ?? null,
        feeTier: null,
        priceUsd: Number(pair.priceUsd),
        liquidityUsd: pair.liquidity?.usd ?? null,
        volume24hUsd: pair.volume?.h24 ?? null,
        priceChange24hPct: pair.priceChange?.h24 ?? null,
        marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
        lastPriceUpdateAt: new Date().toISOString(),
        isStale: false,
      },
    };
  }

  private async listEvm(address: string, pairs: DexScreenerPair[]): Promise<{ evmMarketId: string } | null> {
    const pair = bestOwnPair(pairs, address, (c) => c in DEXSCREENER_EVM);
    if (!pair?.chainId || !pair.pairAddress || (pair.liquidity?.usd ?? 0) < MIN_LIQUIDITY_USD) return null;
    const chainId = DEXSCREENER_EVM[pair.chainId]!;
    const client = this.clients.get(chainId);
    const usdc = EVM_USDC_BY_CHAIN_ID[chainId];
    const chain = await prisma.chain.findUnique({ where: { identifier: `eip155:${chainId}` }, select: { id: true } });
    if (!client || !usdc || !chain) return null;

    const security = await this.goPlus(chainId, address);
    if (unsafe(security)) {
      this.logger.info({ address, chainId }, 'Token lookup: not listed — failed the security check');
      return null;
    }
    const quote = await prisma.token.findFirst({ where: { chainId: chain.id, contractAddress: { equals: usdc.address, mode: 'insensitive' } }, select: { id: true } });
    if (!quote) return null;
    const contract = getAddress(address);
    const [decimals, symbol, name] = await Promise.all([
      client.readContract({ address: contract, abi: erc20Abi, functionName: 'decimals' }),
      client.readContract({ address: contract, abi: erc20Abi, functionName: 'symbol' }).catch(() => pair.baseToken?.symbol ?? null),
      client.readContract({ address: contract, abi: erc20Abi, functionName: 'name' }).catch(() => pair.baseToken?.name ?? null),
    ]);

    const token = await prisma.token.upsert({
      where: { chainId_contractAddress: { chainId: chain.id, contractAddress: contract } },
      update: {},
      create: {
        chainId: chain.id,
        contractAddress: contract,
        symbol,
        name,
        decimals,
        logoUrl: pair.info?.imageUrl?.startsWith('https://') ? pair.info.imageUrl : null,
      },
    });
    const existing = await prisma.tokenMarket.findFirst({ where: { chainId: chain.id, tokenId: token.id }, select: { id: true } });
    if (existing) return { evmMarketId: existing.id };
    const market = await prisma.tokenMarket.create({
      data: {
        chainId: chain.id,
        tokenId: token.id,
        quoteTokenId: quote.id,
        dex: `agg:${pair.dexId ?? 'dex'}`,
        pairAddress: pair.pairAddress,
        priceUsd: Number(pair.priceUsd),
        liquidityUsd: pair.liquidity?.usd ?? null,
        volume24hUsd: pair.volume?.h24 ?? null,
        priceChange24hPct: clampPct(pair.priceChange?.h24),
        marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
        lastPriceUpdateAt: new Date(),
      },
      select: { id: true },
    });
    this.logger.info({ address: contract, chainId, dex: pair.dexId }, 'Token lookup: listed a coin found by address');
    return { evmMarketId: market.id };
  }

  private async goPlus(chainId: number, address: string): Promise<GoPlusResult | undefined> {
    try {
      const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${GOPLUS_CHAIN[chainId]}?contract_addresses=${address}`, { signal: AbortSignal.timeout(8_000) });
      const body = (await res.json()) as { result?: Record<string, GoPlusResult> };
      return Object.entries(body.result ?? {}).find(([k]) => k.toLowerCase() === address.toLowerCase())?.[1];
    } catch {
      return undefined;
    }
  }
}
