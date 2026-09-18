import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS, type MarketSummary, type PumpFunTokenSummary } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { toMarketSummary } from '../market/market.mapper';
import { TrenchesCategory } from './trenches-category.enum';

const CACHE_TTL_SECONDS = 30;
/** How many recently-active incomplete curves to consider for NEAR_GRADUATED before
 *  sorting — see resolveNearGraduated's own doc comment for why this can't be a plain
 *  database ORDER BY. */
const NEAR_GRADUATED_CANDIDATE_POOL_SIZE = 500;

/**
 * A launchpad-lifecycle-style token filter, a 4-category "Trenches" endpoint (FRESH /
 * NEAR_GRADUATED / JUST_GRADUATED / TRENDING_HOLDERS, mirroring Pump.fun/Four.meme style
 * categorization). The first three are backed by real, live Pump.fun bonding-curve data —
 * see apps/workers/src/pumpfun/pumpfun-ingestion.ts and docs/TRADING.md#pump-fun-trenches
 * — as of 2026-09-14; `TRENDING_HOLDERS` predates them and stays on Kamby's existing
 * EVM/Uniswap market data.
 *
 * The two data sources return genuinely different shapes — `PumpFunTokenSummary` for the
 * bonding-curve categories, `MarketSummary` for TRENDING_HOLDERS — deliberately not forced
 * into one schema (a bonding curve has no `dex`/`feeTier`/pool-quote-token in the Uniswap
 * sense `MarketSummary` assumes). See PumpFunTokenSummarySchema's own doc comment.
 *
 * "Holders" and "1h volume" for TRENDING_HOLDERS aren't fields Kamby's EVM indexer tracks
 * either — this uses the closest honest proxies it actually has: `uniqueTraders24h`
 * (distinct wallets, not total holders) and `volume24hUsd` (24h, not 1h). Documented here
 * rather than silently passed off as the literal spec'd metrics.
 */
@Injectable()
export class TokenTrenchesService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TokenTrenchesService');
  }

  async byCategory(category: TrenchesCategory, limit: number): Promise<MarketSummary[] | PumpFunTokenSummary[]> {
    switch (category) {
      case TrenchesCategory.TRENDING_HOLDERS:
        return this.trendingHolders(limit);
      case TrenchesCategory.FRESH:
        return this.fresh(limit);
      case TrenchesCategory.NEAR_GRADUATED:
        return this.nearGraduated(limit);
      case TrenchesCategory.JUST_GRADUATED:
        return this.justGraduated(limit);
    }
  }

  /** Proxy for the spec'd `holder_count >= 500 OR volume_1h >= 50000` — see this class's
   *  own doc comment for why these particular fields stand in for those. */
  private async trendingHolders(limit: number): Promise<MarketSummary[]> {
    const MIN_UNIQUE_TRADERS_24H = 500;
    const MIN_VOLUME_24H_USD = 50_000;

    return this.cached(`tokens:trenches:trending-holders:${limit}`, async () => {
      const rows = await prisma.tokenMarket.findMany({
        where: {
          OR: [{ uniqueTraders24h: { gte: MIN_UNIQUE_TRADERS_24H } }, { volume24hUsd: { gte: MIN_VOLUME_24H_USD } }],
        },
        orderBy: [{ uniqueTraders24h: 'desc' }, { volume24hUsd: 'desc' }],
        take: limit,
        include: { token: true, quoteToken: true, chain: true },
      });
      return rows.map((row) => toMarketSummary(row));
    });
  }

  /** Newest bonding curves that haven't graduated — the straightforward case, a plain
   *  indexed ORDER BY (see PumpFunToken's own `@@index([complete, createdAt])`). */
  private async fresh(limit: number): Promise<PumpFunTokenSummary[]> {
    return this.cached(`tokens:trenches:fresh:${limit}`, async () => {
      const rows = await prisma.pumpFunToken.findMany({
        where: { complete: false },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      return rows.map((row) => toPumpFunTokenSummary(row));
    });
  }

  /**
   * Closest to Pump.fun's ~85 SOL graduation threshold. Deliberately NOT a plain
   * `ORDER BY real_sol_reserves DESC`: that column is stored as a string (see PumpFunToken's
   * own doc comment on why — the same "never a native numeric type for a raw on-chain
   * amount" rule every money-shaped field in this codebase follows), and Postgres would sort
   * a TEXT column lexicographically, not numerically ("9000000000" would sort after
   * "80000000000" despite being the smaller number). Instead: pull a recency-bounded
   * candidate pool (bounded so this stays cheap even with many long-abandoned curves sitting
   * in the table) and sort that pool by real value using BigInt comparison in application
   * code, which is exact and can't misorder the way a float cast could.
   */
  private async nearGraduated(limit: number): Promise<PumpFunTokenSummary[]> {
    return this.cached(`tokens:trenches:near-graduated:${limit}`, async () => {
      const candidates = await prisma.pumpFunToken.findMany({
        where: { complete: false },
        orderBy: { lastStateUpdateAt: 'desc' },
        take: NEAR_GRADUATED_CANDIDATE_POOL_SIZE,
      });
      const sorted = candidates.sort((a, b) => {
        const diff = BigInt(b.realSolReserves) - BigInt(a.realSolReserves);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });
      return sorted.slice(0, limit).map((row) => toPumpFunTokenSummary(row));
    });
  }

  /** Most recently graduated — a plain indexed ORDER BY, same reasoning as `fresh` above
   *  (`graduatedAt` is a real DateTime column, unlike the reserve fields). */
  private async justGraduated(limit: number): Promise<PumpFunTokenSummary[]> {
    return this.cached(`tokens:trenches:just-graduated:${limit}`, async () => {
      const rows = await prisma.pumpFunToken.findMany({
        where: { complete: true },
        orderBy: { graduatedAt: 'desc' },
        take: limit,
      });
      return rows.map((row) => toPumpFunTokenSummary(row));
    });
  }

  /** Short TTL relative to Discovery's own cache — this reflects live trading activity
   *  (unique traders, volume), which staleness affects faster than Discovery's rankings. */
  private async cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Trenches cache read failed — computing fresh');
    }

    const value = await compute();

    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn({ err: error, key }, 'Trenches cache write failed — result still served, just not cached');
    }

    return value;
  }
}

/** `Number.MAX_SAFE_INTEGER`-safe: dividing two BigInts first keeps the ratio itself small
 *  (well under 2^53) before it ever becomes a JS number, unlike converting a raw multi-
 *  billion-lamport reserve value directly — see docs/TRADING.md#financial-precision. */
function graduationProgressPct(realSolReserves: string): number {
  const raised = BigInt(realSolReserves);
  const bps = (raised * 10_000n) / PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS;
  const pct = Number(bps) / 100;
  return Math.min(100, pct);
}

function toPumpFunTokenSummary(row: {
  mintAddress: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  virtualSolReserves: string;
  virtualTokenReserves: string;
  realSolReserves: string;
  realTokenReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  createdAt: Date;
  graduatedAt: Date | null;
}): PumpFunTokenSummary {
  return {
    mintAddress: row.mintAddress,
    name: row.name,
    symbol: row.symbol,
    uri: row.uri,
    virtualSolReserves: row.virtualSolReserves,
    virtualTokenReserves: row.virtualTokenReserves,
    realSolReserves: row.realSolReserves,
    realTokenReserves: row.realTokenReserves,
    tokenTotalSupply: row.tokenTotalSupply,
    graduationProgressPct: graduationProgressPct(row.realSolReserves),
    complete: row.complete,
    createdAt: row.createdAt.toISOString(),
    graduatedAt: row.graduatedAt?.toISOString() ?? null,
  };
}
