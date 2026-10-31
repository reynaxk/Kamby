import { Inject, Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { NEWS_LATEST_REDIS_KEY, newsTokenKey, type NewsItem, type NewsPage, type NewsToken } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';

export const NEWS_PAGE_DEFAULT = 20;
export const NEWS_PAGE_MAX = 50;

/** Exported for tests. One page of `items` (newest first) older than `before`, optionally one coin's. */
export function pageFromLatest(items: NewsItem[], opts: { tokenKey?: string; before?: string; limit: number }): NewsPage {
  const matching = items.filter(
    (item) =>
      (!opts.tokenKey || item.tokens.some((t) => newsTokenKey(t.chainIdentifier, t.tokenAddress) === opts.tokenKey)) &&
      (!opts.before || item.publishedAt < opts.before),
  );
  const page = matching.slice(0, opts.limit);
  return { items: page, nextBefore: matching.length > opts.limit ? page[page.length - 1]!.publishedAt : null };
}

/**
 * Crypto news reads (2026-10-31). The workers keep the latest 100 headlines in Redis
 * (`kamby:news:latest`) — the first page comes straight from there; older pages and anything
 * past those 100 come from the Postgres archive.
 */
@Injectable()
export class NewsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('NewsService');
  }

  async list(opts: { chainIdentifier?: string; tokenAddress?: string; before?: string; limit?: number }): Promise<NewsPage> {
    const limit = Math.min(Math.max(opts.limit ?? NEWS_PAGE_DEFAULT, 1), NEWS_PAGE_MAX);
    const tokenKey = opts.chainIdentifier && opts.tokenAddress ? newsTokenKey(opts.chainIdentifier, opts.tokenAddress) : undefined;

    const latest = await this.latest();
    const fromCache = pageFromLatest(latest, { tokenKey, before: opts.before, limit });
    // A full page from the cache: no database round trip.
    if (fromCache.items.length === limit) return fromCache;

    try {
      const rows = await prisma.newsArticle.findMany({
        where: {
          ...(tokenKey && { tokenKeys: { has: tokenKey } }),
          ...(opts.before && { publishedAt: { lt: new Date(opts.before) } }),
        },
        orderBy: { publishedAt: 'desc' },
        take: limit + 1,
      });
      const items = rows.slice(0, limit).map(
        (row): NewsItem => ({
          id: row.id,
          sourceId: row.sourceId,
          title: row.title,
          summary: row.summary,
          url: row.url,
          publishedAt: row.publishedAt.toISOString(),
          tokens: row.tokens as NewsToken[],
        }),
      );
      return { items, nextBefore: rows.length > limit ? items[items.length - 1]!.publishedAt : null };
    } catch (error) {
      // Archive unavailable — the cached headlines are still the right answer.
      this.logger.warn({ err: error }, 'News archive read failed');
      return fromCache;
    }
  }

  private async latest(): Promise<NewsItem[]> {
    try {
      const raw = await this.redis.get(NEWS_LATEST_REDIS_KEY);
      return raw ? (JSON.parse(raw) as NewsItem[]) : [];
    } catch (error) {
      this.logger.warn({ err: error }, 'News cache read failed');
      return [];
    }
  }
}
