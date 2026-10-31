import { createHash } from 'node:crypto';
import {
  NEWS_LATEST_MAX,
  NEWS_LATEST_REDIS_KEY,
  NEWS_REALTIME_CHANNEL,
  NEWS_SOURCES,
  NEWS_VERIFIED_TICKERS,
  canonicalNewsUrl,
  cleanNewsText,
  matchNewsTickers,
  newsSnippet,
  newsTokenKey,
  normalizeNewsTitle,
  type NewsItem,
  type NewsSource,
} from '@kamby/domain';
import { prisma } from '@kamby/db';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import Parser from 'rss-parser';

const FEED_TIMEOUT_MS = 5_000;
const MAX_FEED_BYTES = 2_000_000;
const LATEST_TTL_SECONDS = 24 * 60 * 60;
const SEEN_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Only stories this fresh go out live — a restart or a feed re-posting old items never floods
 *  everyone with toasts. */
const LIVE_WINDOW_MS = 20 * 60_000;
const MAX_LIVE_PER_POLL = 5;
/** Older than this isn't news any more (some feeds keep weeks of items). */
const MAX_AGE_MS = 3 * 24 * 60 * 60_000;
/** A verified coin is only tagged while Kamby's own market for it holds this much liquidity. */
const MIN_LIQUIDITY_USD = 50_000;
/** Only one workers instance polls, even if several run with the flag on. */
const LOCK_KEY = 'kamby:news:poll-lock';

const parser = new Parser({ timeout: FEED_TIMEOUT_MS });

/** Exported for tests. One feed's items as clean NewsItems (no tags yet), newest first. */
export async function parseFeed(xml: string, source: NewsSource, now = Date.now()): Promise<Omit<NewsItem, 'tokens'>[]> {
  const feed = await parser.parseString(xml);
  const items: Omit<NewsItem, 'tokens'>[] = [];
  for (const entry of feed.items ?? []) {
    const title = cleanNewsText(entry.title);
    const url = canonicalNewsUrl(entry.link ?? entry.guid, source);
    const published = Date.parse(entry.isoDate ?? entry.pubDate ?? '');
    if (!title || !url || !Number.isFinite(published)) continue;
    if (now - published > MAX_AGE_MS) continue;
    const summary = newsSnippet(cleanNewsText(entry.content ?? entry.summary ?? entry.contentSnippet ?? ''));
    items.push({
      id: createHash('sha256').update(normalizeNewsTitle(title)).digest('hex').slice(0, 32),
      sourceId: source.id,
      title,
      summary: summary === title ? '' : summary,
      url,
      // A feed stamping a story in the future would pin it to the top.
      publishedAt: new Date(Math.min(published, now)).toISOString(),
    });
  }
  return items;
}

async function fetchFeed(source: NewsSource): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(source.feedUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KambyNews/1.0; +https://kambesh.com)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    if (body.length > MAX_FEED_BYTES) throw new Error('feed too large');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Crypto news (2026-10-31): polls the five RSS feeds in parallel (5s each — a slow one never
 * holds up the rest), cleans and de-duplicates the items, tags verified coins that still have a
 * live market, keeps the latest 100 in Redis and an archive in Postgres, and publishes fresh
 * stories for the app's live feed and alerts.
 */
export class NewsIngestionService {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async poll(): Promise<{ fetched: number; added: number; live: number; failedFeeds: number }> {
    const locked = await this.redis.set(LOCK_KEY, '1', 'EX', 100, 'NX');
    if (locked !== 'OK') return { fetched: 0, added: 0, live: 0, failedFeeds: 0 };

    const results = await Promise.allSettled(NEWS_SOURCES.map(async (source) => parseFeed(await fetchFeed(source), source)));
    let failedFeeds = 0;
    const byId = new Map<string, Omit<NewsItem, 'tokens'>>();
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        failedFeeds++;
        this.logger.warn({ source: NEWS_SOURCES[i]!.id, err: String(result.reason).slice(0, 200) }, 'News feed failed');
        return;
      }
      for (const item of result.value) {
        const existing = byId.get(item.id);
        // Same story on two feeds: keep the earliest.
        if (!existing || item.publishedAt < existing.publishedAt) byId.set(item.id, item);
      }
    });

    const liveTickers = await this.tickersWithLiquidity();
    const items: NewsItem[] = [...byId.values()].map((item) => ({
      ...item,
      tokens: matchNewsTickers(item.title, item.summary)
        .filter((t) => t.major || liveTickers.has(newsTokenKey(t.chainIdentifier, t.tokenAddress)))
        .map(({ symbol, chainIdentifier, tokenAddress }) => ({ symbol, chainIdentifier, tokenAddress })),
    }));

    // New = never seen before (SET NX per id, kept a week).
    const fresh: NewsItem[] = [];
    if (items.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const item of items) pipeline.set(`kamby:news:seen:${item.id}`, '1', 'EX', SEEN_TTL_SECONDS, 'NX');
      const replies = (await pipeline.exec()) ?? [];
      items.forEach((item, i) => {
        if (replies[i]?.[1] === 'OK') fresh.push(item);
      });
    }

    // Latest 100: merge with what's stored so a feed that failed this time keeps its items.
    const stored = await this.latest();
    const merged = new Map<string, NewsItem>();
    for (const item of [...items, ...stored]) if (!merged.has(item.id)) merged.set(item.id, item);
    const latest = [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, NEWS_LATEST_MAX);
    await this.redis.set(NEWS_LATEST_REDIS_KEY, JSON.stringify(latest), 'EX', LATEST_TTL_SECONDS);

    if (fresh.length > 0) await this.archive(fresh);

    const now = Date.now();
    const live = fresh
      .filter((item) => now - Date.parse(item.publishedAt) <= LIVE_WINDOW_MS)
      .sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
      .slice(-MAX_LIVE_PER_POLL);
    for (const item of live) await this.redis.publish(NEWS_REALTIME_CHANNEL, JSON.stringify(item));

    return { fetched: items.length, added: fresh.length, live: live.length, failedFeeds };
  }

  private async latest(): Promise<NewsItem[]> {
    try {
      const raw = await this.redis.get(NEWS_LATEST_REDIS_KEY);
      return raw ? (JSON.parse(raw) as NewsItem[]) : [];
    } catch {
      return [];
    }
  }

  /** Postgres history. Best effort — Redis already serves the app, so a failed write is logged, not fatal. */
  private async archive(items: NewsItem[]): Promise<void> {
    try {
      await prisma.newsArticle.createMany({
        data: items.map((item) => ({
          id: item.id,
          sourceId: item.sourceId,
          title: item.title,
          summary: item.summary,
          url: item.url,
          publishedAt: new Date(item.publishedAt),
          tokens: item.tokens,
          tokenKeys: item.tokens.map((t) => newsTokenKey(t.chainIdentifier, t.tokenAddress)),
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'News archive write failed');
    }
  }

  /** Liquidity guard: the verified coins whose Kamby market currently holds ≥ $50K. */
  private async tickersWithLiquidity(): Promise<Set<string>> {
    const keys = new Set<string>();
    const evm = NEWS_VERIFIED_TICKERS.filter((t) => !t.major && t.chainIdentifier.startsWith('eip155:'));
    const solana = NEWS_VERIFIED_TICKERS.filter((t) => !t.major && t.chainIdentifier === 'solana');
    try {
      const [evmMarkets, solanaMarkets] = await Promise.all([
        prisma.tokenMarket.findMany({
          where: {
            liquidityUsd: { gte: MIN_LIQUIDITY_USD },
            token: { contractAddress: { in: evm.map((t) => t.tokenAddress), mode: 'insensitive' } },
          },
          select: { chain: { select: { identifier: true } }, token: { select: { contractAddress: true } } },
        }),
        prisma.solanaTokenMarket.findMany({
          where: { liquidityUsd: { gte: MIN_LIQUIDITY_USD }, mintAddress: { in: solana.map((t) => t.tokenAddress) } },
          select: { mintAddress: true },
        }),
      ]);
      for (const m of evmMarkets) keys.add(newsTokenKey(m.chain.identifier, m.token.contractAddress));
      for (const m of solanaMarkets) keys.add(newsTokenKey('solana', m.mintAddress));
    } catch (error) {
      // No guard answer means no small-coin tags this poll — never unguarded tags.
      this.logger.warn({ err: error }, 'News liquidity check failed');
    }
    return keys;
  }
}
