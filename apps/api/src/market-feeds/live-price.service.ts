import { Inject, Injectable, NotFoundException, Optional, type MessageEvent, type OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { pickChartPair, SOLANA_STANDARD_QUOTE_MINTS, type LivePrice, type PricedPair, type TokenInfoChain } from '@kamby/domain';
import { prisma } from '@kamby/db';
import { PinoLogger } from 'nestjs-pino';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { CryptoPriceService } from './crypto-price.service';
import { geckoCoolingDown, noteGeckoStatus } from '../market/gecko-ohlcv';
import { isListedCoin } from './listed-coins';

const DEXSCREENER_CHAIN: Record<TokenInfoChain, string> = { base: 'base', bnb: 'bsc', solana: 'solana' };
/** DexScreener's token endpoint takes up to 30 addresses per call. */
const BATCH_SIZE = 30;
/** A live curve read older than this is ignored (the stream is down or the coin went quiet). */
const LIVE_CURVE_MAX_AGE_MS = 60_000;
const POLL_MS = 1_500; // 2026-10-06: prices felt slow at 2s; DexScreener's 300/min allows it
/** A coin stays watched this long after its last viewer asked for it. */
const WATCH_TTL_MS = 20_000;

interface DexScreenerPair {
  pairAddress?: string;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
}

/** Exported for tests. The price of each requested token from DexScreener's pairs: only
 *  pairs where it's the *base* token (priceUsd is the base token's price), the deepest one. */
export function pricesFromPairs(pairs: DexScreenerPair[], chain: TokenInfoChain): Map<string, number> {
  return new Map([...poolPricesFromPairs(pairs, chain)].map(([k, v]) => [k, v.priceUsd]));
}

/** Exported for tests. Each token's price and the pool it's from — its chart pool when that's
 *  one of DexScreener's sane pairs (`preferred`, keyed like the result), else the deepest sane pair. */
export function poolPricesFromPairs(
  pairs: DexScreenerPair[],
  chain: TokenInfoChain,
  preferred: ReadonlyMap<string, string> = new Map(),
): Map<string, { priceUsd: number; poolAddress?: string }> {
  const byToken = new Map<string, PricedPair[]>();
  for (const pair of pairs) {
    const address = pair.baseToken?.address;
    const price = Number(pair.priceUsd);
    if (!address || !Number.isFinite(price) || price <= 0) continue;
    const key = chain === 'solana' ? address : address.toLowerCase();
    byToken.set(key, [...(byToken.get(key) ?? []), { priceUsd: price, liquidityUsd: pair.liquidity?.usd ?? 0, quoteAddress: pair.quoteToken?.address, pairAddress: pair.pairAddress }]);
  }
  // The chart pool, else the deepest sane pool — mispriced outlier pools are ignored (see pickSanePair).
  const prices = new Map<string, { priceUsd: number; poolAddress?: string }>();
  for (const [key, candidates] of byToken) {
    const best = pickChartPair(candidates, preferred.get(key), chain === 'solana' ? SOLANA_STANDARD_QUOTE_MINTS : undefined);
    if (best) prices.set(key, { priceUsd: best.priceUsd, poolAddress: best.pairAddress });
  }
  return prices;
}

/** Exported for tests. A Pump.fun coin's USD price from its bonding curve's virtual reserves
 *  (SOL has 9 decimals, Pump.fun tokens 6): SOL per token × the SOL price. */
export function curvePriceUsd(virtualSolReserves: string, virtualTokenReserves: string, solUsd: number): number | null {
  const sol = Number(virtualSolReserves) / 1e9;
  const tokens = Number(virtualTokenReserves) / 1e6;
  if (!(sol > 0) || !(tokens > 0) || !(solUsd > 0)) return null;
  return (sol / tokens) * solUsd;
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
  /** Every tick's prices, pushed to open streams (see stream()). */
  private readonly ticks = new Subject<void>();

  /** Base/BNB coins' chart pools (Kamby's indexed market), cached — they rarely change. */
  private readonly evmPools = new Map<string, { pool: string | null; at: number }>();

  constructor(
    private readonly logger: PinoLogger,
    private readonly cryptoPrices: CryptoPriceService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
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

  /**
   * Pushed live price (2026-10-07): the same price as price(), sent to the browser right after
   * each poll tick instead of the browser asking every 1.5s — up to 1.5s fresher and one open
   * request per coin instead of 40 a minute. Errors (an unlisted coin) end the stream; the
   * browser then falls back to polling price().
   */
  stream(chain: TokenInfoChain, address: string): Observable<MessageEvent> {
    const key = this.key(chain, address);
    return new Observable<MessageEvent>((subscriber) => {
      const send = () => {
        const latest = this.latest.get(key);
        if (latest) subscriber.next({ type: 'price', data: latest });
      };
      this.price(chain, address).then(send, (error: unknown) => subscriber.error(error));
      const sub = this.ticks.subscribe(send);
      const keepAlive = setInterval(() => {
        this.watched.set(key, { chain, address, until: Date.now() + WATCH_TTL_MS });
        this.ensurePolling();
        subscriber.next({ type: 'heartbeat', data: '' });
      }, 10_000);
      return () => {
        sub.unsubscribe();
        clearInterval(keepAlive);
      };
    });
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
    if (this.ticks.observed) this.ticks.next();
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
        this.logger.warn({ status: response.status }, 'DexScreener live price request failed — using backup sources');
        await this.backupPrices(chain, addresses, new Date().toISOString());
        return;
      }
      const body = (await response.json()) as unknown;
      const prices = poolPricesFromPairs(Array.isArray(body) ? (body as DexScreenerPair[]) : [], chain, await this.chartPools(chain, addresses));
      const atIso = new Date().toISOString();
      const missing: string[] = [];
      for (const address of addresses) {
        const price = prices.get(chain === 'solana' ? address : address.toLowerCase());
        if (price !== undefined) this.latest.set(this.key(chain, address), { priceUsd: price.priceUsd, atIso, ...(price.poolAddress ? { poolAddress: price.poolAddress } : {}) });
        else missing.push(address);
      }
      // A brand-new Pump.fun coin DexScreener hasn't listed yet (2026-10-05: Trenches coins had
      // no price at all): its bonding curve, which the workers keep current on-chain, prices it.
      if (chain === 'solana' && missing.length > 0) await this.curvePrices(missing, atIso);
      // Bonding-curve coins: the live curve beats every polled source.
      if (chain === 'solana') await this.liveCurvePrices(addresses, atIso);
      const stillMissing = missing.filter((a) => !this.freshlyPriced(chain, a, atIso));
      if (stillMissing.length > 0) await this.backupPrices(chain, stillMissing, atIso);
    } catch (error) {
      this.logger.warn({ err: error }, 'DexScreener unreachable for live prices — using backup sources');
      await this.backupPrices(chain, addresses, new Date().toISOString());
    }
  }

  private freshlyPriced(chain: TokenInfoChain, address: string, atIso: string): boolean {
    return this.latest.get(this.key(chain, address))?.atIso === atIso;
  }

  /**
   * Backup live prices (2026-10-06: "we can't rely on one provider"), used only when DexScreener
   * errors, rate-limits, or has no price for a coin. Solana: Jupiter's price API (prices from the
   * pools Jupiter routes through). Base/BNB: GeckoTerminal's token prices (its shared budget is
   * respected — skipped while it's cooling down). The last known price stays otherwise.
   */
  private async backupPrices(chain: TokenInfoChain, addresses: string[], atIso: string): Promise<void> {
    try {
      if (chain === 'solana') {
        for (let i = 0; i < addresses.length; i += 50) {
          const ids = addresses.slice(i, i + 50);
          const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${ids.join(',')}`, { signal: AbortSignal.timeout(4000) });
          if (!res.ok) continue;
          const body = (await res.json()) as Record<string, { usdPrice?: number } | null>;
          for (const id of ids) {
            const usd = body[id]?.usdPrice;
            if (typeof usd === 'number' && usd > 0) this.latest.set(this.key('solana', id), { ...this.latest.get(this.key('solana', id)), priceUsd: usd, atIso });
          }
        }
        return;
      }
      if (geckoCoolingDown()) return;
      const network = chain === 'base' ? 'base' : 'bsc';
      for (let i = 0; i < addresses.length; i += 30) {
        const ids = addresses.slice(i, i + 30);
        const res = await fetch(`https://api.geckoterminal.com/api/v2/simple/networks/${network}/token_price/${ids.join(',')}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        noteGeckoStatus(res.status);
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { attributes?: { token_prices?: Record<string, string> } } };
        const prices = body.data?.attributes?.token_prices ?? {};
        for (const id of ids) {
          const usd = Number(prices[id.toLowerCase()] ?? prices[id]);
          if (usd > 0) this.latest.set(this.key(chain, id), { ...this.latest.get(this.key(chain, id)), priceUsd: usd, atIso });
        }
      }
    } catch (error) {
      this.logger.warn({ err: error, chain }, 'backup live prices unavailable — keeping the last known price');
    }
  }

  /**
   * Each coin's chart pool, so its live price comes from the market its candles show
   * (2026-10-05: Live/10s and the candle widths read different pools and disagreed). Base/BNB:
   * the pool Kamby indexes (TokenMarket — the candles' own source). Solana: the pool the candle
   * service chose (`chart-pool:solana:<mint>`, see SolanaChartService). Keyed like poolPricesFromPairs.
   */
  private async chartPools(chain: TokenInfoChain, addresses: string[]): Promise<Map<string, string>> {
    const pools = new Map<string, string>();
    try {
      if (chain === 'solana') {
        if (!this.redis || addresses.length === 0) return pools;
        const values = await this.redis.mget(addresses.map((a) => `chart-pool:solana:${a}`));
        addresses.forEach((a, i) => values[i] && pools.set(a, values[i]!));
        return pools;
      }
      const now = Date.now();
      const missing = addresses.filter((a) => {
        const hit = this.evmPools.get(`${chain}:${a.toLowerCase()}`);
        return !hit || now - hit.at > 10 * 60_000;
      });
      if (missing.length > 0) {
        const markets = await prisma.tokenMarket.findMany({
          where: { token: { contractAddress: { in: missing, mode: 'insensitive' } } },
          select: { pairAddress: true, liquidityUsd: true, token: { select: { contractAddress: true } } },
          orderBy: { liquidityUsd: 'desc' },
        });
        for (const a of missing) this.evmPools.set(`${chain}:${a.toLowerCase()}`, { pool: null, at: now });
        for (const m of markets) {
          const key = `${chain}:${m.token.contractAddress.toLowerCase()}`;
          if (this.evmPools.get(key)?.pool === null) this.evmPools.set(key, { pool: m.pairAddress, at: now }); // deepest first
        }
      }
      for (const a of addresses) {
        const pool = this.evmPools.get(`${chain}:${a.toLowerCase()}`)?.pool;
        if (pool) pools.set(a.toLowerCase(), pool);
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'chart pools unavailable — live prices use the deepest pool');
    }
    return pools;
  }

  /**
   * Real-time prices for bonding-curve coins (2026-10-06): the workers' live curve subscription
   * (pf-curve-live:<mint>, written on every trade) priced × SOL. Applied after DexScreener each
   * tick so a coin still on its curve shows the price of its latest trade, not DexScreener's
   * few-seconds-old read. Entries older than LIVE_CURVE_MAX_AGE_MS are ignored.
   */
  private async liveCurvePrices(mints: string[], atIso: string): Promise<void> {
    if (!this.redis || mints.length === 0) return;
    const solUsd = this.cryptoPrices.snapshot().find((p) => p.symbol === 'SOL')?.priceUsd;
    if (!solUsd) return;
    try {
      const values = await this.redis.mget(mints.map((m) => `pf-curve-live:${m}`));
      values.forEach((raw, i) => {
        if (!raw) return;
        const live = JSON.parse(raw) as { virtualSolReserves?: string; virtualTokenReserves?: string; complete?: boolean; at?: number };
        if (live.complete || !live.at || Date.now() - live.at > LIVE_CURVE_MAX_AGE_MS) return;
        const price = curvePriceUsd(live.virtualSolReserves ?? '0', live.virtualTokenReserves ?? '0', solUsd);
        if (price !== null) this.latest.set(this.key('solana', mints[i]!), { ...this.latest.get(this.key('solana', mints[i]!)), priceUsd: price, atIso });
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'live curve prices unavailable');
    }
  }

  private async curvePrices(mints: string[], atIso: string): Promise<void> {
    const solUsd = this.cryptoPrices.snapshot().find((p) => p.symbol === 'SOL')?.priceUsd;
    if (!solUsd) return;
    try {
      const curves = await prisma.pumpFunToken.findMany({
        where: { mintAddress: { in: mints }, complete: false },
        select: { mintAddress: true, virtualSolReserves: true, virtualTokenReserves: true },
      });
      for (const curve of curves) {
        const price = curvePriceUsd(curve.virtualSolReserves, curve.virtualTokenReserves, solUsd);
        if (price !== null) this.latest.set(this.key('solana', curve.mintAddress), { priceUsd: price, atIso });
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'bonding-curve live prices unavailable');
    }
  }
}
