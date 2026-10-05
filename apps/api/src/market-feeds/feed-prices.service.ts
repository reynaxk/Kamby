import { Injectable } from '@nestjs/common';
import type { MarketSummary, TokenInfoChain } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { pricesFromPairs } from './live-price.service';

const DEXSCREENER_CHAIN: Record<TokenInfoChain, string> = { base: 'base', bnb: 'bsc', solana: 'solana' };
const BATCH_SIZE = 30; // DexScreener's tokens endpoint takes up to 30 addresses per call
const FRESH_MS = 8_000; // shared by every tab rebuilt in the same 10s cycle
const FETCH_TIMEOUT_MS = 4_000;

function chainOf(chainIdentifier: string): TokenInfoChain | null {
  if (chainIdentifier === 'solana') return 'solana';
  if (chainIdentifier === 'eip155:8453') return 'base';
  if (chainIdentifier === 'eip155:56') return 'bnb';
  return null;
}

/** Exported for tests. A list row with a fresh price: market cap scales with the price (same
 *  supply), and the 24h change is re-based on the fresh price. Untouched without one. */
export function withFreshPrice<T extends Pick<MarketSummary, 'priceUsd' | 'marketCapUsd' | 'priceChange24hPct' | 'lastPriceUpdateAt'>>(
  market: T,
  freshUsd: number | undefined,
  atIso: string,
): T {
  if (freshUsd === undefined || !(freshUsd > 0)) return market;
  const old = market.priceUsd;
  const ratio = old && old > 0 ? freshUsd / old : null;
  return {
    ...market,
    priceUsd: freshUsd,
    marketCapUsd: market.marketCapUsd !== null && ratio !== null ? market.marketCapUsd * ratio : market.marketCapUsd,
    priceChange24hPct:
      market.priceChange24hPct !== null && ratio !== null ? ((1 + market.priceChange24hPct / 100) * ratio - 1) * 100 : market.priceChange24hPct,
    lastPriceUpdateAt: atIso,
  };
}

/**
 * Live prices for the discovery lists (2026-10-05 audit against DexScreener: list prices were a
 * median 53s old and up to 30 minutes for coins that trade rarely through an indexed pool — a
 * meme coin showed +28% off the live price). Every feed rebuild (10s) re-prices every row from
 * DexScreener, batched 30 per call and shared across tabs, so the cost is a handful of calls per
 * cycle however many viewers there are. Same deepest-sane-pair choice as the chart's live price.
 */
@Injectable()
export class FeedPricesService {
  private readonly cache = new Map<string, { usd: number; at: number }>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('FeedPricesService');
  }

  async apply<T extends MarketSummary>(markets: T[]): Promise<T[]> {
    const now = Date.now();
    const stale = new Map<TokenInfoChain, string[]>();
    for (const m of markets) {
      const chain = chainOf(m.chainIdentifier);
      if (!chain) continue;
      const hit = this.cache.get(this.key(chain, m.tokenAddress));
      if (!hit || now - hit.at > FRESH_MS) stale.set(chain, [...(stale.get(chain) ?? []), m.tokenAddress]);
    }
    const requests: Promise<void>[] = [];
    for (const [chain, addresses] of stale) {
      const unique = [...new Set(addresses)];
      for (let i = 0; i < unique.length; i += BATCH_SIZE) requests.push(this.fetchBatch(chain, unique.slice(i, i + BATCH_SIZE)));
    }
    await Promise.all(requests);

    const atIso = new Date().toISOString();
    return markets.map((m) => {
      const chain = chainOf(m.chainIdentifier);
      const fresh = chain ? this.cache.get(this.key(chain, m.tokenAddress)) : undefined;
      // Only a price fetched this cycle or the last few seconds — never an old cached one.
      return fresh && Date.now() - fresh.at <= FRESH_MS * 2 ? withFreshPrice(m, fresh.usd, atIso) : m;
    });
  }

  private key(chain: TokenInfoChain, address: string): string {
    return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
  }

  private async fetchBatch(chain: TokenInfoChain, addresses: string[]): Promise<void> {
    try {
      const res = await fetch(`https://api.dexscreener.com/tokens/v1/${DEXSCREENER_CHAIN[chain]}/${addresses.join(',')}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn({ status: res.status, chain }, 'DexScreener list prices request failed — keeping stored prices');
        return;
      }
      const body = (await res.json()) as unknown;
      const prices = pricesFromPairs(Array.isArray(body) ? (body as Parameters<typeof pricesFromPairs>[0]) : [], chain);
      const at = Date.now();
      for (const [key, usd] of prices) this.cache.set(`${chain}:${key}`, { usd, at });
    } catch (error) {
      this.logger.warn({ err: error, chain }, 'DexScreener unreachable for list prices — keeping stored prices');
    }
  }
}
