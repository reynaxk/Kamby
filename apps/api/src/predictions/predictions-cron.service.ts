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
import { EVENT_CAPS, eventCoin, fetchEventDrafts, fetchEventOutcome } from './polymarket-events';
import { PredictionsService } from './predictions.service';

const GENERATE_EVERY_MS = 2 * 3600_000;
const RESOLVE_EVERY_MS = 2 * 60_000;
/** Kamby keeps about this many automatic polls open at once. */
const OPEN_AUTO_CAP = 300;
/** A coin needs this much in its pools before Kamby asks about its price. */
const MIN_LIQUIDITY_USD = 100_000;
/** Give up on a poll whose price can't be read this long after it ends. */
const GIVE_UP_MS = 6 * 3600_000;
/** A real-world event can take a while to settle after its end date. */
const EVENT_GIVE_UP_MS = 14 * 86_400_000;
/** How often a settled-yet? check runs per event poll. */
const EVENT_CHECK_SECONDS = 30 * 60;
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
  resolutionType: 'PRICE_TARGET' | 'PRICE_RANGE' | 'TOP_GAINER' | 'NARRATIVE_TOP' | 'EXTERNAL_EVENT';
  source: 'AUTO_PRICE' | 'AUTO_NEWS' | 'AUTO_GAINER' | 'AUTO_EVENT';
  coin?: { chainIdentifier: string; tokenAddress: string };
  meta: Record<string, unknown>;
  /** How long the poll stays open. */
  hours: number;
  /** A real-world event's own end (epoch ms) — used instead of `hours`. */
  endsAt?: number;
  dedupeKey: string;
}

const MILESTONES = [1, 2, 5].flatMap((m) => [1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12].map((x) => m * x)).sort((a, b) => a - b);

/** "$50M" / "$1.2B" — market-cap milestones in titles. */
function compactUsd(v: number): string {
  const [div, unit] = v >= 1e12 ? [1e12, 'T'] : v >= 1e9 ? [1e9, 'B'] : [1e6, 'M'];
  return `$${Number((v / div).toFixed(1))}${unit}`;
}

/**
 * Exported for tests. Every poll one generator run could ask, from real prices, narratives and
 * news (2026-11-01: up to ~300 at once). Each `stem` — template + coin — is asked at most once
 * at a time; the generator skips stems that still have an open poll, so no two open polls are
 * the same question. Interleaved by template so a page never shows 30 of one kind in a row.
 */
export function draftPolls(snapshot: NarrativesSnapshot, news: NewsItem[], block: string): Draft[] {
  const tokens = new Map<string, NarrativeToken>();
  for (const n of snapshot.narratives) for (const t of n.tokens) tokens.set(newsTokenKey(t.chainIdentifier, t.tokenAddress), t);
  const liquid = [...tokens.values()].filter((t) => (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD && (t.priceUsd ?? 0) > 0).sort((a, b) => b.heat - a.heat);
  const coinOf = (t: NarrativeToken) => ({ chainIdentifier: t.chainIdentifier, tokenAddress: t.tokenAddress });
  const id = (t: NarrativeToken) => newsTokenKey(t.chainIdentifier, t.tokenAddress);
  const k = (stem: string) => `${stem}|${block}`;
  const lanes: Draft[][] = [];
  const lane = (): Draft[] => {
    const l: Draft[] = [];
    lanes.push(l);
    return l;
  };
  const up = lane();
  const down = lane();
  const greenRed = lane();
  const ranges = lane();
  const mcap = lane();
  const versus = lane();
  const groups = lane();

  for (const [i, t] of liquid.entries()) {
    const p = t.priceUsd!;
    const swing = Math.abs(t.change24hPct ?? 0);
    // A step that fits the coin: majors move 5%, hot memes 20%.
    const step = swing >= 15 ? 0.2 : swing >= 6 ? 0.1 : 0.05;
    const pct = Math.round(step * 100);
    up.push({
      title: `Will ${sym(t)} be above ${usd(p * (1 + step))} in 12 hours?`,
      category: categoryOf(t),
      kind: 'BINARY',
      options: ['Yes', 'No'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_PRICE',
      coin: coinOf(t),
      meta: { threshold: p * (1 + step), symbol: t.symbol, yesIs: 0 },
      hours: 12,
      dedupeKey: k(`up:${id(t)}`),
    });
    down.push({
      title: `Will ${sym(t)} drop ${pct}% (below ${usd(p * (1 - step))}) in the next 10 hours?`,
      category: categoryOf(t),
      kind: 'BINARY',
      options: ['Yes', 'No'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_PRICE',
      coin: coinOf(t),
      meta: { threshold: p * (1 - step), below: true, symbol: t.symbol, yesIs: 0 },
      hours: 10,
      dedupeKey: k(`down:${id(t)}`),
    });
    greenRed.push({
      title: `${sym(t)} in 10 hours: green or red from ${usd(p)}?`,
      category: categoryOf(t),
      kind: 'OVER_UNDER',
      options: ['🟢 Green', '🔴 Red'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_PRICE',
      coin: coinOf(t),
      meta: { threshold: p, symbol: t.symbol, yesIs: 0 },
      hours: 10,
      dedupeKey: k(`greenred:${id(t)}`),
    });
    const lo = p * (1 - step / 2);
    const hi = p * (1 + step / 2);
    ranges.push({
      title: `Where will ${sym(t)} be in 12 hours?`,
      category: categoryOf(t),
      kind: 'RANGES',
      options: [`Below ${usd(lo)}`, `${usd(lo)} – ${usd(hi)}`, `Above ${usd(hi)}`],
      resolutionType: 'PRICE_RANGE',
      source: 'AUTO_PRICE',
      coin: coinOf(t),
      meta: { bounds: [lo, hi], symbol: t.symbol },
      hours: 12,
      dedupeKey: k(`ranges:${id(t)}`),
    });
    // The next round market cap — only when it's within reach (≤ +50%).
    const mc = t.marketCapUsd ?? 0;
    const milestone = MILESTONES.find((m) => m > mc);
    if (mc > 0 && milestone && milestone <= mc * 1.5) {
      const threshold = p * (milestone / mc);
      mcap.push({
        title: `Will ${sym(t)} reach a ${compactUsd(milestone)} market cap in 12 hours?`,
        category: categoryOf(t),
        kind: 'BINARY',
        options: ['Yes', 'No'],
        resolutionType: 'PRICE_TARGET',
        source: 'AUTO_PRICE',
        coin: coinOf(t),
        meta: { threshold, symbol: t.symbol, yesIs: 0, marketCapUsd: milestone },
        hours: 12,
        dedupeKey: k(`mcap:${id(t)}`),
      });
    }
    // Head to head with the next coin of the same kind.
    const rival = liquid.slice(i + 1).find((r) => categoryOf(r) === categoryOf(t) && r.symbol !== t.symbol);
    if (rival) {
      versus.push({
        title: `${sym(t)} vs ${sym(rival)}: which gains more in the next 10 hours?`,
        category: categoryOf(t),
        kind: 'MULTI_CHOICE',
        options: [sym(t), sym(rival)],
        resolutionType: 'TOP_GAINER',
        source: 'AUTO_GAINER',
        meta: { coins: [t, rival].map((c) => ({ ...coinOf(c), start: c.priceUsd })) },
        hours: 10,
        dedupeKey: k(`vs:${id(t)}:${id(rival)}`),
      });
    }
  }

  // Each narrative: which of its coins gains most.
  for (const n of snapshot.narratives) {
    const field = n.tokens.filter((t) => (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD / 2 && (t.priceUsd ?? 0) > 0).slice(0, 4);
    if (field.length < 3) continue;
    groups.push({
      title: `${n.emoji} ${n.name}: which gains the most in the next 12 hours?`,
      category: n.id === 'ai-agents' ? 'ai' : MEME_NARRATIVES.has(n.id) ? 'memes' : 'crypto',
      kind: 'MULTI_CHOICE',
      options: field.map(sym),
      resolutionType: 'TOP_GAINER',
      source: 'AUTO_GAINER',
      meta: { coins: field.map((t) => ({ ...coinOf(t), start: t.priceUsd })) },
      hours: 12,
      dedupeKey: k(`gainer-${n.id}`),
    });
  }
  // Does the hottest narrative stay on top?
  const top = snapshot.narratives[0];
  if (top && snapshot.narratives.length >= 3) {
    groups.push({
      title: `Will ${top.name} still be the hottest narrative on Kamby in 12 hours?`,
      category: top.id === 'ai-agents' ? 'ai' : MEME_NARRATIVES.has(top.id) ? 'memes' : 'crypto',
      kind: 'BINARY',
      options: ['Yes', 'No'],
      resolutionType: 'NARRATIVE_TOP',
      source: 'AUTO_GAINER',
      meta: { narrativeId: top.id },
      hours: 12,
      dedupeKey: k(`narrative-${top.id}`),
    });
  }
  // News: fresh headlines about liquid coins, one per headline.
  const headlines = lane();
  for (const item of news.slice(0, 30)) {
    const tag = item.tokens.map((tk) => tokens.get(newsTokenKey(tk.chainIdentifier, tk.tokenAddress))).find((t) => t && (t.liquidityUsd ?? 0) >= MIN_LIQUIDITY_USD);
    if (!tag) continue;
    const headline = item.title.length > 70 ? `${item.title.slice(0, 67).trimEnd()}…` : item.title;
    headlines.push({
      title: `“${headline}” — will ${sym(tag)} be higher in 10 hours?`,
      category: categoryOf(tag) === 'crypto' ? 'macro' : categoryOf(tag),
      kind: 'BINARY',
      options: ['Bullish', 'Bearish'],
      resolutionType: 'PRICE_TARGET',
      source: 'AUTO_NEWS',
      coin: coinOf(tag),
      meta: { threshold: tag.priceUsd, symbol: tag.symbol, yesIs: 0, newsId: item.id },
      hours: 10,
      dedupeKey: `news:${item.id}`,
    });
    if (headlines.length >= 8) break;
  }

  // Staggered: in each round lane j takes coin r - 3j, so neighbours are about different coins.
  const out: Draft[] = [];
  const longest = Math.max(0, ...lanes.map((l) => l.length));
  for (let r = 0; r < longest + 3 * lanes.length; r++) {
    for (const [j, l] of lanes.entries()) {
      const d = l[r - 3 * j];
      if (d) out.push(d);
    }
  }
  return out;
}

/** A draft's "same question" identity — template + coin, without the time block. */
export function draftStem(dedupeKey: string): string {
  return dedupeKey.split('|')[0]!;
}

/** Exported for tests. The winning option for a price poll, given the price at the end. */
export function resolveByPrice(row: Pick<PredictionRow, 'resolutionType' | 'meta'>, price: number): number | null {
  const meta = (row.meta ?? {}) as { threshold?: number; below?: boolean; bounds?: [number, number] };
  if (row.resolutionType === 'PRICE_TARGET' && typeof meta.threshold === 'number') return (meta.below ? price < meta.threshold : price > meta.threshold) ? 0 : 1;
  if (row.resolutionType === 'PRICE_RANGE' && Array.isArray(meta.bounds)) return price < meta.bounds[0] ? 0 : price <= meta.bounds[1] ? 1 : 2;
  return null;
}

/**
 * Predictions' automation (2026-10-31): every 2 hours it tops the open automatic polls back up to
 * ~300 different questions from real data (each liquid coin's price, market cap and rivals, every
 * narrative, fresh headlines — 2026-11-01); every 2
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

  /** At most once per 2h block (the dedupe keys carry the block). */
  async generate(): Promise<void> {
    const block = String(Math.floor(Date.now() / GENERATE_EVERY_MS));
    if ((await this.redis.get('kamby:pred:last-block')) === block) return;
    const [snapshot, newsRaw] = await Promise.all([this.narratives.snapshot(), this.redis.get(NEWS_LATEST_REDIS_KEY).catch(() => null)]);
    const news = newsRaw ? (JSON.parse(newsRaw) as NewsItem[]) : [];
    const open = await prisma.prediction.findMany({
      where: { status: 'ACTIVE', expiresAt: { gt: new Date() }, source: { in: ['AUTO_PRICE', 'AUTO_NEWS', 'AUTO_GAINER'] } },
      select: { dedupeKey: true },
    });
    const asked = new Set(open.map((r) => (r.dedupeKey ? draftStem(r.dedupeKey) : '')));
    const coinPicks = draftPolls(snapshot, news, block)
      .filter((d) => !asked.has(draftStem(d.dedupeKey)))
      .slice(0, Math.max(0, OPEN_AUTO_CAP - open.length));

    // Politics and crypto events, topped up to their own caps.
    const eventLanes: Draft[][] = [];
    for (const category of ['politics', 'crypto'] as const) {
      try {
        const openEvents = await prisma.prediction.findMany({ where: { status: 'ACTIVE', source: 'AUTO_EVENT', category }, select: { id: true, title: true, meta: true, chainIdentifier: true, dedupeKey: true } });
        // Questions asked before 2026-11-01's coin charts get their coin now.
        for (const row of openEvents) {
          const about = row.chainIdentifier ? null : eventCoin(row.title);
          if (!about) continue;
          const meta = { ...(row.meta as object), symbol: about.symbol, ...(about.threshold !== null && { threshold: about.threshold }) };
          await prisma.prediction.update({ where: { id: row.id }, data: { chainIdentifier: about.coin.chainIdentifier, tokenAddress: about.coin.tokenAddress, meta } });
        }
        const have = new Set(openEvents.map((r) => r.dedupeKey));
        eventLanes.push((await fetchEventDrafts(category)).filter((d) => !have.has(d.dedupeKey)).slice(0, Math.max(0, EVENT_CAPS[category] - openEvents.length)));
      } catch (error) {
        this.logger.warn({ err: error, category }, 'Predictions: event questions unavailable');
      }
    }

    // Inserted in the order the list shows them (newest first): one event after every 4 coin
    // polls, politics and crypto taking turns, so neither kind fills the top of the page.
    const events: Draft[] = [];
    for (let i = 0; eventLanes.some((l) => i < l.length); i++) for (const l of eventLanes) if (l[i]) events.push(l[i]!);
    const mixed: Draft[] = [];
    let e = 0;
    for (const [i, d] of coinPicks.entries()) {
      mixed.push(d);
      if (i % 4 === 3 && e < events.length) mixed.push(events[e++]!);
    }
    mixed.push(...events.slice(e));
    let created = 0;
    // Newest-first lists show the last insert on top, so insert the mix back to front.
    for (const d of mixed.reverse()) created += await this.insert(d);
    await this.redis.set('kamby:pred:last-block', block, 'EX', GENERATE_EVERY_MS / 1000);
    if (created > 0) this.logger.info({ created }, 'Predictions generated');
  }

  private async insert(d: Draft): Promise<number> {
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
          expiresAt: new Date(d.endsAt ?? Date.now() + d.hours * 3600_000),
          dedupeKey: d.dedupeKey,
        },
      ],
      skipDuplicates: true,
    });
    return res.count;
  }

  async resolve(): Promise<void> {
    const due = await prisma.prediction.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: new Date() } }, orderBy: { expiresAt: 'desc' }, take: 200 });
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
      } else if (row.resolutionType === 'EXTERNAL_EVENT') {
        // The real event settles on its own time — ask about each at most every 30 min.
        const marketId = (row.meta as { marketId?: string }).marketId;
        if (marketId && (await this.redis.set(`kamby:pred:ext:${row.id}`, '1', 'EX', EVENT_CHECK_SECONDS, 'NX')) === 'OK') outcome = await fetchEventOutcome(marketId).catch(() => null);
        if (outcome !== null) await this.finish(row, 'RESOLVED', outcome);
        else if (Date.now() - row.expiresAt.getTime() > EVENT_GIVE_UP_MS) await this.finish(row, 'EXPIRED', null);
        continue;
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
