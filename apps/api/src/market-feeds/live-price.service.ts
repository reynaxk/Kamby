import { Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import type { LivePrice, TokenInfoChain } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { isListedCoin } from './listed-coins';

const DEXSCREENER_CHAIN: Record<TokenInfoChain, string> = { base: 'base', bnb: 'bsc', solana: 'solana' };
/** DexScreener's token endpoint takes up to 30 addresses per call. */
const BATCH_SIZE = 30;
const POLL_MS = 2_000;
/** A coin stays watched this long after its last viewer asked for it. */
const WATCH_TTL_MS = 20_000;

interface DexScreenerPair {
  baseToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

/** Exported for tests. The price of each requested token from DexScreener's pairs: only
 *  pairs where it's the *base* token (priceUsd is the base token's price), the deepest one. */
export function pricesFromPairs(pairs: DexScreenerPair[], chain: TokenInfoChain): Map<string, number> {
  const best = new Map<string, { price: number; liquidity: number }>();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    const price = Number(pair.priceUsd);
    if (!address || !Number.isFinite(price) || price <= 0) continue;
    const key = chain === 'solana' ? address : address.toLowerCase();
    const liquidity = pair.liquidity?.usd ?? 0;
    const current = best.get(key);
    if (!current || liquidity > current.liquidity) best.set(key, { price, liquidity });
  }
  return new Map([...best].map(([key, v]) => [key, v.price]));
}

/**
 * Near-real-time prices for the chart's "Live" timeframe (user request 2026-09-30). One
 * batched DexScreener call per chain every 2s covers every coin anyone is currently watching
 * (up to 30 per call), so the upstream cost is fixed by the number of distinct coins being
 * viewed, never by the number of viewers. Polling stops when nobody is watching.
 */
@Injectable()
export class LivePriceService implements OnModuleDestroy {
  private readonly watched = new Map<string, { chain: TokenInfoChain; address: string; until: number }>();
  private readonly latest = new Map<string, LivePrice>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext('LivePriceService');
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async price(chain: TokenInfoChain, address: string): Promise<LivePrice | null> {
    const key = this.key(chain, address);
    if (!this.watched.has(key) && !(await isListedCoin(chain, address))) {
      throw new NotFoundException('Kamby does not list this coin');
    }
    this.watched.set(key, { chain, address, until: Date.now() + WATCH_TTL_MS });
    this.ensurePolling();
    // A coin's very first viewer gets a price straight away rather than an empty first tick.
    if (!this.latest.has(key)) await this.poll([{ chain, address }]);
    return this.latest.get(key) ?? null;
  }

  private key(chain: TokenInfoChain, address: string): string {
    return `${chain}:${chain === 'solana' ? address : address.toLowerCase()}`;
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    const now = Date.now();
    for (const [key, entry] of this.watched) {
      if (entry.until < now) {
        this.watched.delete(key);
        this.latest.delete(key);
      }
    }
    if (this.watched.size === 0) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    this.polling = true;
    try {
      await this.poll([...this.watched.values()]);
    } finally {
      this.polling = false;
    }
  }

  private async poll(coins: { chain: TokenInfoChain; address: string }[]): Promise<void> {
    const byChain = new Map<TokenInfoChain, string[]>();
    for (const coin of coins) byChain.set(coin.chain, [...(byChain.get(coin.chain) ?? []), coin.address]);
    const requests: Promise<void>[] = [];
    for (const [chain, addresses] of byChain) {
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        requests.push(this.fetchBatch(chain, addresses.slice(i, i + BATCH_SIZE)));
      }
    }
    await Promise.all(requests);
  }

  private async fetchBatch(chain: TokenInfoChain, addresses: string[]): Promise<void> {
    try {
      const response = await fetch(`https://api.dexscreener.com/tokens/v1/${DEXSCREENER_CHAIN[chain]}/${addresses.join(',')}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'DexScreener live price request failed');
        return;
      }
      const body = (await response.json()) as unknown;
      const prices = pricesFromPairs(Array.isArray(body) ? (body as DexScreenerPair[]) : [], chain);
      const atIso = new Date().toISOString();
      for (const address of addresses) {
        const price = prices.get(chain === 'solana' ? address : address.toLowerCase());
        if (price !== undefined) this.latest.set(this.key(chain, address), { priceUsd: price, atIso });
      }
    } catch (error) {
      // Keep the last known price; the next tick retries.
      this.logger.warn({ err: error }, 'DexScreener unreachable for live prices');
    }
  }
}
