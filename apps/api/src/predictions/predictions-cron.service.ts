import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { prisma, type Prediction as PredictionRow } from '@kamby/db';
import {
  NEWS_LATEST_REDIS_KEY,
  narrativesOf,
  newsTokenKey,
  type NarrativeToken,
  type NarrativesSnapshot,
  type NewsItem,
  type PredictionCategory,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { NarrativesService, tokenFromPairs, type NarrativePair } from '../narratives/narratives.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PredictionsService } from './predictions.service';

const GENERATE_EVERY_MS = 4 * 3600_000;
const RESOLVE_EVERY_MS = 2 * 60_000;
const POLL_HOURS = 24;
/** A coin needs this much in its pools before Kamby asks about its price. */
const MIN_LIQUIDITY_USD = 250_000;
/** Give up on a poll whose price can't be read this long after it ends. */
const GIVE_UP_MS = 6 * 3600_000;
const DEX_CHAIN: Record<string, string> = { solana: 'solana', 'eip155:8453': 'base', 'eip155:56': 'bsc', 'eip155:4663': 'robinhood' };
const MEME_NARRATIVES = new Set(['solana-memes', 'base-memes', 'bnb-memes', 'dogs', 'cats', 'frogs']);

/** "$1,234.56" / "$0.0001234" — for titles and option labels. */
export function usd(v: number): string {
  if (v >= 1) return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${v.toLocaleString('en-US', { maximumSignificantDigits: 4 })}`;
}

function categoryOf(token: Pick<NarrativeToken, 'chainIdentifier' | 'tokenAddress' | 'symbol' | 'name'>): PredictionCategory {
  const tags = narrativesOf(token);
  if (tags.includes('ai-agents')) return 'ai';
  if (tags.some((t) => MEME_NARRATIVES.has(t))) return 'memes';
  if (tags.includes('majors')) return 'macro';
  return 'crypto';
}

const sym = (t: { symbol: string | null }) => `$${(t.symbol ?? '?').replace(/^\$+/, '')}`;

export interface Draft {
  title: string;
  category: PredictionCategory;
  kind: 'BINARY' | 'MULTI_CHOICE' | 'OVER_UNDER' | 'RANGES';
  options: string[];
  resolutionType: 'PRICE_TARGET' | 'PRICE_RANGE' | 'TOP_GAINER' | 'NARRATIVE_TOP';
  source: 'AUTO_PRICE' | 'AUTO_NEWS' | 'AUTO_GAINER';
  coin?: { chainIdentifier: string; tokenAddress: string };
  meta: Record<string, unknown>;
  dedupeKey: string;
}

/** Exported for tests. The polls one generator run asks, from real prices, narratives and news. */
export function draftPolls(snapshot: NarrativesSnapshot, news: NewsItem[], block: string): Draft[] {
  const tokens = new Map<string, NarrativeToken>();
  for (const n of snapshot.narratives) for (const t of n.tokens) tokens.set(newsTokenKey(t.chainIdentifier, t.tokenAddress), t);
  const liquid = [...tokens.values()].filter((t) => (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD && (t.priceUsd ?? 0) > 0);
  const hottest = [...liquid].sort((a, b) => b.heat - a.heat);
  const drafts: Draft[] = [];
  const coinOf = (t: NarrativeToken) => ({ chainIdentifier: t.chainIdentifier, tokenAddress: t.tokenAddress });
  const k = (template: string, t?: NarrativeToken) => `${template}:${t ? newsTokenKey(t.chainIdentifier, t.tokenAddress) : 'all'}:${block}`;

  // Binary: the two hottest coins, 5% up.
  for (const t of hottest.slice(0, 2)) {
    const target = t.priceUsd! * 1.05;
    drafts.push({
      title: `Will ${sym(t)} be above ${usd(target)} in 24 hours?`,
      category: categoryOf(t),
      kind: 'BINARY',
      options: ['Yes', 'No'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_PRICE',
      coin: coinOf(t),
      meta: { threshold: target, symbol: t.symbol, yesIs: 0 },
      dedupeKey: k('above5', t),
    });
  }
  // Over / under and ranges on the deepest coin.
  const deepest = [...liquid].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0];
  if (deepest) {
    const p = deepest.priceUsd!;
    drafts.push({
      title: `${sym(deepest)} in 24 hours: over or under ${usd(p)}?`,
      category: categoryOf(deepest),
      kind: 'OVER_UNDER',
      options: [`Over ${usd(p)}`, `Under ${usd(p)}`],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_PRICE',
      coin: coinOf(deepest),
      meta: { threshold: p, symbol: deepest.symbol, yesIs: 0 },
      dedupeKey: k('overunder', deepest),
    });
    const lo = p * 0.97;
    const hi = p * 1.03;
    drafts.push({
      title: `Where will ${sym(deepest)} be in 24 hours?`,
      category: categoryOf(deepest),
      kind: 'RANGES',
      options: [`Below ${usd(lo)}`, `${usd(lo)} – ${usd(hi)}`, `Above ${usd(hi)}`],
      resolutionType: 'PRICE_RANGE',
      source: 'AUTO_PRICE',
      coin: coinOf(deepest),
      meta: { bounds: [lo, hi], symbol: deepest.symbol },
      dedupeKey: k('ranges', deepest),
    });
  }
  // Multi-choice: which of the hottest narrative's coins gains most.
  const top = snapshot.narratives[0];
  const field = top?.tokens.filter((t) => (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD / 5 && (t.priceUsd ?? 0) > 0).slice(0, 4) ?? [];
  if (top && field.length >= 3) {
    drafts.push({
      title: `${top.emoji} ${top.name}: which gains the most in the next 24 hours?`,
      category: top.id === 'ai-agents' ? 'ai' : MEME_NARRATIVES.has(top.id) ? 'memes' : 'crypto',
      kind: 'MULTI_CHOICE',
      options: field.map(sym),
      resolutionType: 'TOP_GAINER',
      source: 'AUTO_GAINER',
      meta: { coins: field.map((t) => ({ ...coinOf(t), start: t.priceUsd })) },
      dedupeKey: k(`gainer-${top.id}`),
    });
  }
  // Narrative: does the hottest stay on top?
  if (top && snapshot.narratives.length >= 3) {
    drafts.push({
      title: `Will ${top.name} still be the hottest narrative on Kamby in 24 hours?`,
      category: top.id === 'ai-agents' ? 'ai' : MEME_NARRATIVES.has(top.id) ? 'memes' : 'crypto',
      kind: 'BINARY',
      options: ['Yes', 'No'],
      resolutionType: 'NARRATIVE_TOP',
      source: 'AUTO_GAINER',
      meta: { narrativeId: top.id },
      dedupeKey: k(`narrative-${top.id}`),
    });
  }
  // News: a fresh headline about a liquid coin.
  for (const item of news.slice(0, 20)) {
    const tag = item.tokens.map((tk) => tokens.get(newsTokenKey(tk.chainIdentifier, tk.tokenAddress))).find((t) => t && (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD);
    if (!tag) continue;
    const headline = item.title.length > 70 ? `${item.title.slice(0, 67).trimEnd()}…` : item.title;
    drafts.push({
      title: `“${headline}” — will ${sym(tag)} be higher in 24 hours?`,
      category: categoryOf(tag) === 'crypto' ? 'macro' : categoryOf(tag),
      kind: 'BINARY',
      options: ['Bullish', 'Bearish'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_NEWS',
      coin: coinOf(tag),
      meta: { threshold: tag.priceUsd, symbol: tag.symbol, yesIs: 0, newsId: item.id },
      dedupeKey: `news:${item.id}`,
    });
    break;
  }
  return drafts;
}

/** Exported for tests. The winning option for a price poll, given the price at the end. */
export function resolveByPrice(row: Pick<PredictionRow, 'resolutionType' | 'meta'>, price: number): number | null {
  const meta = (row.meta ?? {}) as { threshold?: number; bounds?: [number, number] };
  if (row.resolutionType === 'PRICE_TARGET' && typeof meta.threshold === 'number') return price > meta.threshold ? 0 : 1;
  if (row.resolutionType === 'PRICE_RANGE' && Array.isArray(meta.bounds)) return price < meta.bounds[0] ? 0 : price <= meta.bounds[1] ? 1 : 2;
  return null;
}

/**
 * Predictions' automation (2026-10-31): every 4 hours it asks a handful of new questions from real
 * data (the hottest coins, the deepest coin, the hottest narrative, a fresh headline); every 2
 * minutes it closes finished polls — price polls resolve from the coin's own pool price, the
 * narrative poll from the Heat Index, streamers' and users' polls just close. One API instance
 * does each run (Redis lock).
 */
@Injectable()
export class PredictionsCronService implements OnModuleInit, OnModuleDestroy {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly narratives: NarrativesService,
    private readonly predictions: PredictionsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('PredictionsCronService');
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    const every = (ms: number, first: number, run: () => Promise<void>) => {
      const tick = () => void run().catch((error: unknown) => this.logger.warn({ err: error }, 'Predictions job failed'));
      this.timers.push(setTimeout(tick, first), setInterval(tick, ms));
    };
    every(15 * 60_000, 60_000, () => this.locked('gen', 14 * 60, () => this.generate()));
    every(RESOLVE_EVERY_MS, 90_000, () => this.locked('resolve', 100, () => this.resolve()));
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }

  private async locked(name: string, seconds: number, run: () => Promise<void>): Promise<void> {
    const ok = await this.redis.set(`kamby:pred:lock:${name}`, '1', 'EX', seconds, 'NX');
    if (ok === 'OK') await run();
  }

  /** At most once per 4h block (the dedupe keys carry the block). */
  async generate(): Promise<void> {
    const block = String(Math.floor(Date.now() / GENERATE_EVERY_MS));
    if ((await this.redis.get('kamby:pred:last-block')) === block) return;
    const [snapshot, newsRaw] = await Promise.all([this.narratives.snapshot(), this.redis.get(NEWS_LATEST_REDIS_KEY).catch(() => null)]);
    const news = newsRaw ? (JSON.parse(newsRaw) as NewsItem[]) : [];
    const drafts = draftPolls(snapshot, news, block);
    const expiresAt = new Date(Date.now() + POLL_HOURS * 3600_000);
    let created = 0;
    for (const d of drafts) {
      const res = await prisma.prediction.createMany({
        data: [
          {
            title: d.title,
            category: d.category,
            kind: d.kind,
            options: d.options,
            resolutionType: d.resolutionType,
            source: d.source,
            chainIdentifier: d.coin?.chainIdentifier ?? null,
            tokenAddress: d.coin?.tokenAddress ?? null,
            meta: d.meta as object,
            expiresAt,
            dedupeKey: d.dedupeKey,
          },
        ],
        skipDuplicates: true,
      });
      created += res.count;
    }
    await this.redis.set('kamby:pred:last-block', block, 'EX', GENERATE_EVERY_MS / 1000);
    if (created > 0) this.logger.info({ created }, 'Predictions generated');
  }

  async resolve(): Promise<void> {
    const due = await prisma.prediction.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, take: 100 });
    if (due.length === 0) return;
    const coins = new Map<string, { chainIdentifier: string; tokenAddress: string }>();
    for (const row of due) {
      if (row.chainIdentifier && row.tokenAddress) coins.set(newsTokenKey(row.chainIdentifier, row.tokenAddress), { chainIdentifier: row.chainIdentifier, tokenAddress: row.tokenAddress });
      for (const c of ((row.meta as { coins?: { chainIdentifier: string; tokenAddress: string }[] }).coins ?? [])) coins.set(newsTokenKey(c.chainIdentifier, c.tokenAddress), c);
    }
    const prices = await this.prices([...coins.values()]);
    const needsNarratives = due.some((r) => r.resolutionType === 'NARRATIVE_TOP');
    const snapshot = needsNarratives ? await this.narratives.snapshot().catch(() => null) : null;

    for (const row of due) {
      let outcome: number | null = null;
      if (row.resolutionType === 'PRICE_TARGET' || row.resolutionType === 'PRICE_RANGE') {
        const price = row.chainIdentifier && row.tokenAddress ? prices.get(newsTokenKey(row.chainIdentifier, row.tokenAddress)) : undefined;
        if (price !== undefined) outcome = resolveByPrice(row, price);
      } else if (row.resolutionType === 'TOP_GAINER') {
        const field = ((row.meta as { coins?: { chainIdentifier: string; tokenAddress: string; start: number }[] }).coins ?? []).map((c) => {
          const now = prices.get(newsTokenKey(c.chainIdentifier, c.tokenAddress));
          return now !== undefined && c.start > 0 ? now / c.start : null;
        });
        if (field.length > 0 && field.every((x) => x !== null)) outcome = field.indexOf(Math.max(...(field as number[])));
      } else if (row.resolutionType === 'NARRATIVE_TOP' && snapshot) {
        outcome = snapshot.narratives[0]?.id === (row.meta as { narrativeId?: string }).narrativeId ? 0 : 1;
      } else {
        // A streamer's or user's poll: it just closes; the votes are the result.
        await this.finish(row, 'EXPIRED', null);
        continue;
      }
      if (outcome !== null) await this.finish(row, 'RESOLVED', outcome);
      else if (Date.now() - row.expiresAt.getTime() > GIVE_UP_MS) await this.finish(row, 'EXPIRED', null);
    }
  }

  private async finish(row: PredictionRow, status: 'RESOLVED' | 'EXPIRED', outcome: number | null): Promise<void> {
    await prisma.prediction.update({ where: { id: row.id }, data: { status, resolvedOptionIndex: outcome, resolvedAt: new Date() } });
    const counts = (await this.predictions.ensureCounts([row])).get(row.id) ?? row.options.map(() => 0);
    await this.predictions.publish({ id: row.id, counts, total: counts.reduce((a, b) => a + b, 0), status, resolvedOptionIndex: outcome });
  }

  private async prices(coins: { chainIdentifier: string; tokenAddress: string }[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const byChain = new Map<string, typeof coins>();
    for (const c of coins) if (DEX_CHAIN[c.chainIdentifier]) byChain.set(c.chainIdentifier, [...(byChain.get(c.chainIdentifier) ?? []), c]);
    await Promise.all(
      [...byChain].map(async ([chain, list]) => {
        for (let i = 0; i < list.length; i += 30) {
          const batch = list.slice(i, i + 30);
          try {
            const res = await fetch(`https://api.dexscreener.com/tokens/v1/${DEX_CHAIN[chain]}/${batch.map((c) => c.tokenAddress).join(',')}`, { signal: AbortSignal.timeout(5_000) });
            if (!res.ok) continue;
            const body = (await res.json()) as unknown;
            const pairs = Array.isArray(body) ? (body as NarrativePair[]) : [];
            for (const c of batch) {
              const t = tokenFromPairs({ ...c, symbol: null, name: null, logoUrl: null }, pairs);
              if (t?.priceUsd) out.set(newsTokenKey(c.chainIdentifier, c.tokenAddress), t.priceUsd);
            }
          } catch {
            // that batch waits for the next run
          }
        }
      }),
    );
    return out;
  }
}
