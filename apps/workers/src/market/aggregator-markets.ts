import type { EvmChainDataProvider } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import { pickSanePair } from '@kamby/domain';
import type { Logger } from 'pino';
import { getAddress } from 'viem';

/**
 * Base and BNB coins from every DEX — Aerodrome, Uniswap v4 (Clanker, Zora) and v2 (Virtuals),
 * PancakeSwap v2 (four.meme graduates) and Infinity, launchpad pools (user request
 * 2026-10-03: "a lot of coins choices"). Kamby's own ingestion only reads Uniswap-v3-style
 * pools, which were 5 of the top 20 trending pools on each chain. These coins are
 * "aggregator-priced": price, liquidity, volume and market cap come from DexScreener (one
 * call per 30 coins), charts from GeckoTerminal. KyberSwap trades all of them from USDC
 * (verified live). They're stored as ordinary TokenMarket rows with `dex = "agg:<dex id>"`, so
 * MarketIngestionService skips them and everything else (lists, search, trading) just works.
 */
export const AGGREGATOR_DEX_PREFIX = 'agg:';

const DEXSCREENER_CHAIN: Record<number, string> = { 8453: 'base', 56: 'bsc' };
const SAFETY_CHAIN: Record<number, string> = { 8453: '8453', 56: '56' };
const MIN_RESERVE_USD = 10_000;
const MIN_BUYERS_24H = 20;
const MIN_SELLERS_24H = 10;
const MAX_TAX = 0.1;
const DEXSCREENER_BATCH = 30;
const MAX_NEW_PER_TICK = 25;

/** The majors a memecoin pool is quoted in — never listed as the "coin" side of a pool. */
const MAJOR_SYMBOLS = new Set(['WETH', 'ETH', 'USDC', 'USDT', 'WBNB', 'BNB', 'BTCB', 'CBBTC', 'DAI', 'FDUSD', 'USD1', 'VIRTUAL']);

export interface GeckoPool {
  attributes?: {
    address?: string;
    name?: string;
    reserve_in_usd?: string;
    transactions?: { h24?: { buyers?: number; sellers?: number } };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

/** Exported for tests. The coin a pool lists (the non-major side), or null if it isn't a candidate. */
export function aggregatorCandidate(pool: GeckoPool, skipDexIds: readonly string[]): { pool: string; token: string; symbol: string | null; dex: string } | null {
  const a = pool.attributes;
  const dex = pool.relationships?.dex?.data?.id;
  const address = a?.address;
  if (!a || !dex || !address || skipDexIds.includes(dex)) return null;
  if (Number(a.reserve_in_usd ?? 0) < MIN_RESERVE_USD) return null;
  const tx = a.transactions?.h24;
  if ((tx?.buyers ?? 0) < MIN_BUYERS_24H || (tx?.sellers ?? 0) < MIN_SELLERS_24H) return null;
  const [baseSymbol, quoteSymbol] = (a.name ?? '').split(' / ').map((s) => s.trim().split(' ')[0]?.toUpperCase() ?? '');
  const baseId = pool.relationships?.base_token?.data?.id?.split('_')[1];
  const quoteId = pool.relationships?.quote_token?.data?.id?.split('_')[1];
  const baseIsMajor = MAJOR_SYMBOLS.has(baseSymbol ?? '');
  const token = baseIsMajor ? quoteId : baseId;
  const symbol = baseIsMajor ? quoteSymbol : baseSymbol;
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token) || MAJOR_SYMBOLS.has(symbol ?? '')) return null;
  return { pool: address, token: getAddress(token), symbol: symbol || null, dex };
}

interface GoPlusResult {
  is_honeypot?: string;
  cannot_sell_all?: string;
  buy_tax?: string;
  sell_tax?: string;
  transfer_pausable?: string;
  is_blacklisted?: string;
}

/** Exported for tests. GoPlus token-security flags that rule a coin out. */
export function failsSecurity(r: GoPlusResult | undefined): boolean {
  if (!r) return true; // no verdict = not listed
  if (r.is_honeypot === '1' || r.cannot_sell_all === '1' || r.transfer_pausable === '1' || r.is_blacklisted === '1') return true;
  return Number(r.buy_tax || 0) > MAX_TAX || Number(r.sell_tax || 0) > MAX_TAX;
}

interface DexScreenerPair {
  pairAddress?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { h24?: number };
  marketCap?: number;
  fdv?: number;
}

export class AggregatorMarketService {
  constructor(
    private readonly evmChainId: number,
    private readonly usdcAddress: string,
    private readonly tokenReader: EvmChainDataProvider,
    private readonly logger: Logger,
  ) {}

  /** Lists new candidates from GeckoTerminal pools that Kamby's own reader can't read. */
  async ingestCandidates(chainDbId: number, pools: GeckoPool[], skipDexIds: readonly string[]): Promise<number> {
    const usdc = await prisma.token.findFirst({ where: { chainId: chainDbId, contractAddress: { equals: this.usdcAddress, mode: 'insensitive' } } });
    if (!usdc) return 0;
    const candidates = new Map<string, NonNullable<ReturnType<typeof aggregatorCandidate>>>();
    for (const pool of pools) {
      const c = aggregatorCandidate(pool, skipDexIds);
      if (c && !candidates.has(c.token.toLowerCase())) candidates.set(c.token.toLowerCase(), c);
    }
    const fresh: typeof candidates extends Map<string, infer V> ? V[] : never = [];
    for (const c of candidates.values()) {
      const listed = await prisma.tokenMarket.findFirst({
        where: { chainId: chainDbId, token: { contractAddress: { equals: c.token, mode: 'insensitive' } } },
        select: { id: true },
      });
      if (!listed) fresh.push(c);
      if (fresh.length >= MAX_NEW_PER_TICK) break;
    }
    if (fresh.length === 0) return 0;

    const security = await this.goPlus(fresh.map((c) => c.token));
    let added = 0;
    for (const c of fresh) {
      if (failsSecurity(security.get(c.token.toLowerCase()))) {
        this.logger.info({ token: c.token, symbol: c.symbol }, 'Aggregator market: rejected by security check');
        continue;
      }
      try {
        const meta = await this.tokenReader.getTokenMetadata(c.token);
        if (meta.decimals === null) continue;
        const token = await prisma.token.upsert({
          where: { chainId_contractAddress: { chainId: chainDbId, contractAddress: c.token } },
          update: {},
          create: { chainId: chainDbId, contractAddress: c.token, symbol: meta.symbol ?? c.symbol, name: meta.name, decimals: meta.decimals },
        });
        await prisma.tokenMarket.create({
          data: { chainId: chainDbId, tokenId: token.id, quoteTokenId: usdc.id, dex: `${AGGREGATOR_DEX_PREFIX}${c.dex}`, pairAddress: c.pool },
        });
        added += 1;
      } catch (error) {
        this.logger.warn({ err: error, token: c.token }, 'Aggregator market: could not list one coin');
      }
    }
    if (added > 0) this.logger.info({ added }, 'Aggregator markets listed');
    return added;
  }

  /** Re-prices every aggregator market on this chain from DexScreener, 30 coins per call. */
  async refreshPrices(chainDbId: number): Promise<number> {
    const markets = await prisma.tokenMarket.findMany({
      where: { chainId: chainDbId, dex: { startsWith: AGGREGATOR_DEX_PREFIX } },
      include: { token: true },
    });
    let updated = 0;
    for (let i = 0; i < markets.length; i += DEXSCREENER_BATCH) {
      const batch = markets.slice(i, i + DEXSCREENER_BATCH);
      const pairs = await this.dexScreener(batch.map((m) => m.token.contractAddress));
      for (const m of batch) {
        const own = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === m.token.contractAddress.toLowerCase());
        const ours = own.find((p) => p.pairAddress?.toLowerCase() === m.pairAddress.toLowerCase());
        const best =
          ours ??
          pickSanePair(own.map((p) => ({ pair: p, priceUsd: Number(p.priceUsd), liquidityUsd: p.liquidity?.usd ?? 0 })))?.pair;
        const price = Number(best?.priceUsd);
        if (!best || !Number.isFinite(price) || price <= 0) continue;
        await prisma.tokenMarket.update({
          where: { id: m.id },
          data: {
            priceUsd: price,
            liquidityUsd: best.liquidity?.usd ?? null,
            volume24hUsd: best.volume?.h24 ?? null,
            priceChange24hPct: best.priceChange?.h24 ?? null,
            marketCapUsd: best.marketCap ?? best.fdv ?? null,
            lastPriceUpdateAt: new Date(),
          },
        });
        updated += 1;
      }
    }
    return updated;
  }

  /** One coin per call — GoPlus's free tier answers only the first address of a batch
   *  (verified 2026-10-03). A coin with no verdict is not listed (failsSecurity). */
  private async goPlus(addresses: string[]): Promise<Map<string, GoPlusResult>> {
    const out = new Map<string, GoPlusResult>();
    for (const address of addresses) {
      try {
        const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${SAFETY_CHAIN[this.evmChainId]}?contract_addresses=${address}`, {
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await res.json()) as { result?: Record<string, GoPlusResult> };
        for (const [k, v] of Object.entries(body.result ?? {})) out.set(k.toLowerCase(), v);
      } catch (error) {
        this.logger.warn({ err: error, address }, 'Aggregator markets: GoPlus check failed for one coin — not listed this tick');
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    return out;
  }

  private async dexScreener(addresses: string[]): Promise<DexScreenerPair[]> {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/${DEXSCREENER_CHAIN[this.evmChainId]}/${addresses.join(',')}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return [];
      const body = (await res.json()) as unknown;
      return Array.isArray(body) ? (body as DexScreenerPair[]) : [];
    } catch {
      return [];
    }
  }
}
