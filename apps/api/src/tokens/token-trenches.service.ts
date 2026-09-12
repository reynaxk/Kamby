import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { MarketSummary } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { toMarketSummary } from '../market/market.mapper';
import { TrenchesCategory } from './trenches-category.enum';

const CACHE_TTL_SECONDS = 30;

/**
 * A launchpad-lifecycle-style token filter, requested as a 4-category "Trenches" endpoint
 * (FRESH / NEAR_GRADUATED / JUST_GRADUATED / TRENDING_HOLDERS, mirroring Pump.fun/Four.meme
 * style categorization). Only `TRENDING_HOLDERS` is real — see the enum's own doc comment
 * for why the other three return an honest 501 instead of an empty or fabricated result:
 * Kamby has never indexed pre-liquidity bonding-curve state on any chain it supports, and a
 * silent empty array here would look identical to "no tokens currently qualify," which is a
 * different, false claim.
 *
 * "Holders" and "1h volume" aren't fields Kamby's indexer tracks either — this uses the
 * closest honest proxies it actually has: `uniqueTraders24h` (distinct wallets, not total
 * holders) and `volume24hUsd` (24h, not 1h). Documented here rather than silently passed
 * off as the literal spec'd metrics.
 */
@Injectable()
export class TokenTrenchesService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TokenTrenchesService');
  }

  async byCategory(category: TrenchesCategory, limit: number): Promise<MarketSummary[]> {
    if (category !== TrenchesCategory.TRENDING_HOLDERS) {
      throw new NotImplementedException(
        `Trenches category ${category} requires bonding-curve/migration data Kamby does not index yet — see TrenchesCategory's doc comment.`,
      );
    }
    return this.trendingHolders(limit);
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
