import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { Candle } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';

const GECKOTERMINAL_API = 'https://api.geckoterminal.com/api/v2/networks/solana';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** The timeframes GeckoTerminal's OHLCV can serve as a true candle width. */
export const SOLANA_CHART_TIMEFRAMES = ['1m', '5m', '1H', '4H', '1D'] as const;
export type SolanaChartTimeframe = (typeof SOLANA_CHART_TIMEFRAMES)[number];
const OHLCV: Record<SolanaChartTimeframe, { unit: 'minute' | 'hour' | 'day'; aggregate: number; ttlSeconds: number }> = {
  '1m': { unit: 'minute', aggregate: 1, ttlSeconds: 30 },
  '5m': { unit: 'minute', aggregate: 5, ttlSeconds: 30 },
  '1H': { unit: 'hour', aggregate: 1, ttlSeconds: 60 },
  '4H': { unit: 'hour', aggregate: 4, ttlSeconds: 120 },
  '1D': { unit: 'day', aggregate: 1, ttlSeconds: 300 },
};
const CANDLE_LIMIT = 200;
const POOL_TTL_SECONDS = 60 * 60;

interface GeckoPool {
  attributes?: { address?: string };
  relationships?: { base_token?: { data?: { id?: string } }; quote_token?: { data?: { id?: string } } };
}

/** Exported for tests. GeckoTerminal's [unixSeconds, o, h, l, c, volumeUsd] rows, newest
 *  first, into Kamby candles, oldest first. Malformed rows are dropped, never guessed. */
export function toCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is number[] => Array.isArray(row) && row.length >= 6 && row.slice(0, 6).every((v) => typeof v === 'number' && Number.isFinite(v)))
    .map(([ts, open, high, low, close, volumeUsd]) => ({ bucketStart: new Date(ts! * 1000).toISOString(), open: open!, high: high!, low: low!, close: close!, volumeUsd: volumeUsd! }))
    .sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

/**
 * Price candles for Solana coins, from GeckoTerminal's free OHLCV API — Kamby doesn't ingest
 * Solana swaps itself (SolanaTokenMarket rows are price snapshots), so without this the
 * Solana trade page had no chart at all (reported 2026-09-30, BONK on mobile).
 *
 * GeckoTerminal's free tier is ~30 calls/minute for the whole API process, so every response
 * is cached in Redis and shared by all viewers: the coin's main pool for an hour, candles for
 * 30s-5min depending on width. And only coins Kamby itself lists are served — the curated
 * Solana markets and Pump.fun coins Kamby watched graduate — so arbitrary mints can't use up
 * that shared budget.
 */
@Injectable()
export class SolanaChartService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('SolanaChartService');
  }

  async history(mint: string, timeframe: string): Promise<Candle[]> {
    if (!(SOLANA_CHART_TIMEFRAMES as readonly string[]).includes(timeframe)) {
      throw new BadRequestException(`timeframe must be one of ${SOLANA_CHART_TIMEFRAMES.join(', ')}`);
    }
    const tf = timeframe as SolanaChartTimeframe;
    if (!(await this.isListed(mint))) throw new NotFoundException('Kamby does not list this Solana coin');

    return this.cached(`solana-chart:candles:${mint}:${tf}`, OHLCV[tf].ttlSeconds, async () => {
      const pool = await this.mainPool(mint);
      if (!pool) return [];
      const { unit, aggregate } = OHLCV[tf];
      const url = `${GECKOTERMINAL_API}/pools/${pool.address}/ohlcv/${unit}?aggregate=${aggregate}&limit=${CANDLE_LIMIT}&currency=usd&token=${pool.side}`;
      const body = await this.fetchJson<{ data?: { attributes?: { ohlcv_list?: unknown } } }>(url);
      return toCandles(body?.data?.attributes?.ohlcv_list);
    });
  }

  private async isListed(mint: string): Promise<boolean> {
    if (mint === SOL_MINT) return true;
    const [curated, graduated] = await Promise.all([
      prisma.solanaTokenMarket.findFirst({ where: { mintAddress: mint }, select: { id: true } }),
      prisma.pumpFunToken.findFirst({ where: { mintAddress: mint, complete: true }, select: { id: true } }),
    ]);
    return curated !== null || graduated !== null;
  }

  /** The coin's first-listed GeckoTerminal pool, and which side of it the coin is on. */
  private async mainPool(mint: string): Promise<{ address: string; side: 'base' | 'quote' } | null> {
    return this.cached(`solana-chart:pool:${mint}`, POOL_TTL_SECONDS, async () => {
      const body = await this.fetchJson<{ data?: GeckoPool[] }>(`${GECKOTERMINAL_API}/tokens/${mint}/pools?page=1`);
      for (const pool of body?.data ?? []) {
        const address = pool.attributes?.address;
        if (!address) continue;
        if (pool.relationships?.base_token?.data?.id === `solana_${mint}`) return { address, side: 'base' as const };
        if (pool.relationships?.quote_token?.data?.id === `solana_${mint}`) return { address, side: 'quote' as const };
      }
      return null;
    });
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'GeckoTerminal request failed');
        return null;
      }
      return (await response.json()) as T;
    } catch (error) {
      this.logger.warn({ err: error }, 'GeckoTerminal unreachable');
      return null;
    }
  }

  private async cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      // Redis down — compute fresh.
    }
    const value = await compute();
    // An empty result (GeckoTerminal down, no pool) is only cached briefly, so it recovers fast.
    const empty = value === null || (Array.isArray(value) && value.length === 0);
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', empty ? 15 : ttlSeconds);
    } catch {
      // Served uncached.
    }
    return value;
  }
}
