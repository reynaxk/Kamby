import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, type Prediction as PredictionRow } from '@kamby/db';
import {
  PREDICTION_CATEGORIES,
  PREDICTION_LIMITS,
  PREDICTION_REALTIME_CHANNEL,
  containsLink,
  type LiveRoom,
  type Prediction,
  type PredictionCategory,
  type PredictionFilter,
  type PredictionKind,
  type PredictionStatus,
  type PredictionUpdate,
  type PredictionsPage,
  type ProfilePredictions,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { LiveService } from '../live/live.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LeaderboardService } from '../social/services/leaderboard.service';

const PAGE = 30;
const COUNTS_TTL_SECONDS = 3 * 24 * 3600;
const RECENTLY_RESOLVED_MS = 24 * 3600_000;
/** A person's own polls running at once. */
const MAX_OPEN_PER_USER = 3;
const TOP_TRADERS = 50;

const countsKey = (id: string) => `kamby:pred:${id}:c`;

interface Meta {
  threshold?: number;
  symbol?: string | null;
}

/** Exported for tests. A row (plus its live counts) as the app sees it. */
export function toPrediction(
  row: PredictionRow,
  counts: number[],
  extra: { myVote: number | null; onAir: Set<string>; hosts: Map<string, string | null>; authorName?: string | null },
): Prediction {
  const meta = (row.meta ?? {}) as Meta;
  const now = Date.now();
  const status: PredictionStatus = row.status === 'ACTIVE' && row.expiresAt.getTime() <= now ? 'EXPIRED' : (row.status as PredictionStatus);
  return {
    id: row.id,
    title: row.title,
    category: (PREDICTION_CATEGORIES as readonly string[]).includes(row.category) ? (row.category as PredictionCategory) : 'crypto',
    kind: row.kind as PredictionKind,
    options: row.options,
    counts,
    total: counts.reduce((a, b) => a + b, 0),
    status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedOptionIndex: row.resolvedOptionIndex,
    myVote: extra.myVote,
    coin: row.chainIdentifier && row.tokenAddress ? { chainIdentifier: row.chainIdentifier, tokenAddress: row.tokenAddress, symbol: meta.symbol ?? null } : null,
    live: row.liveRoomId ? { roomId: row.liveRoomId, onAir: extra.onAir.has(row.liveRoomId), hostUsername: extra.hosts.get(row.liveRoomId) ?? extra.authorName ?? null } : null,
    author: row.createdByUserId ? { username: extra.authorName ?? null } : null,
    thresholdUsd: typeof meta.threshold === 'number' ? meta.threshold : null,
  };
}

/**
 * Predictions (2026-10-31) — free community forecasts. Reading is public; voting needs a session,
 * one vote per person per poll. Live vote counts sit in a Redis hash per poll (rebuilt from the
 * votes table when missing) and every vote is published for the live stream. Votes only — no
 * money, stakes, points or prizes (see @kamby/domain predictions.ts).
 */
@Injectable()
export class PredictionsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly live: LiveService,
    private readonly leaderboard: LeaderboardService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('PredictionsService');
  }

  async list(
    me: string | null,
    filter: PredictionFilter,
    category: PredictionCategory | undefined,
    before: string | undefined,
    coin?: { chainIdentifier: string; tokenAddress: string },
  ): Promise<PredictionsPage> {
    const now = new Date();
    const cat = { ...(category ? { category } : {}), ...(coin ? { chainIdentifier: coin.chainIdentifier, tokenAddress: { equals: coin.tokenAddress, mode: 'insensitive' as const } } : {}) };
    const beforeDate = before ? new Date(before) : undefined;
    const open = { status: 'ACTIVE', expiresAt: { gt: now } };
    let rows: PredictionRow[];
    if (filter === 'ending') {
      rows = await prisma.prediction.findMany({ where: { ...open, ...cat }, orderBy: { expiresAt: 'asc' }, take: PAGE });
    } else if (filter === 'popular') {
      rows = await prisma.prediction.findMany({ where: { ...open, ...cat }, orderBy: [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }], take: PAGE });
    } else if (filter === 'mine') {
      if (!me) return { items: [], nextBefore: null, stats: await this.stats(me), canCreate: false };
      rows = await prisma.prediction.findMany({
        where: { votes: { some: { userId: me } }, ...cat, ...(beforeDate && { createdAt: { lt: beforeDate } }) },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
      });
    } else {
      rows = await prisma.prediction.findMany({
        where: {
          ...cat,
          ...(filter === 'streamers' ? { source: 'STREAMER' } : {}),
          OR: [open, { status: 'RESOLVED', resolvedAt: { gt: new Date(now.getTime() - RECENTLY_RESOLVED_MS) } }],
          ...(beforeDate && { createdAt: { lt: beforeDate } }),
        },
        orderBy: { createdAt: 'desc' },
        take: PAGE + 1,
      });
    }
    const page = rows.slice(0, PAGE);
    const nextBefore = rows.length > PAGE ? page[page.length - 1]!.createdAt.toISOString() : null;
    const [items, stats, canCreate] = await Promise.all([this.present(page, me), this.stats(me), me ? this.canCreate(me) : Promise.resolve(false)]);
    return { items, nextBefore, stats, canCreate };
  }

  /** A trader's profile tab: polls they asked, polls they voted on, and their hit rate. */
  async forProfile(viewer: string | null, address: string): Promise<ProfilePredictions> {
    const wallet = await prisma.wallet.findFirst({ where: { address: { equals: address, mode: 'insensitive' }, verifiedAt: { not: null } }, select: { userId: true } });
    const empty: ProfilePredictions = { created: [], voted: [], stats: { votes: 0, resolved: 0, correct: 0, accuracyPct: null } };
    if (!wallet?.userId) return empty;
    const userId = wallet.userId;
    const [createdRows, votes] = await Promise.all([
      prisma.prediction.findMany({ where: { createdByUserId: userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.predictionVote.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 500, include: { prediction: true } }),
    ]);
    const resolved = votes.filter((v) => v.prediction.status === 'RESOLVED' && v.prediction.resolvedOptionIndex !== null);
    const correct = resolved.filter((v) => v.optionIndex === v.prediction.resolvedOptionIndex).length;
    const recent = votes.slice(0, 30);
    const [created, voted] = await Promise.all([this.present(createdRows, viewer), this.present(recent.map((v) => v.prediction), viewer)]);
    return {
      created,
      voted: voted.map((p, i) => ({ ...p, theirVote: recent[i]!.optionIndex })),
      stats: { votes: votes.length, resolved: resolved.length, correct, accuracyPct: resolved.length > 0 ? Math.round((correct / resolved.length) * 100) : null },
    };
  }

  async vote(me: string, id: string, option: number): Promise<Prediction> {
    const row = await prisma.prediction.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('This prediction is gone.');
    if (row.status !== 'ACTIVE' || row.expiresAt.getTime() <= Date.now()) throw new BadRequestException('Voting has closed on this one.');
    if (!Number.isInteger(option) || option < 0 || option >= row.options.length) throw new BadRequestException('Pick one of the answers.');
    // Counts are read (and seeded from the table) before this vote exists, then bumped once.
    const counts = await this.ensureCounts([row]);
    try {
      await prisma.predictionVote.create({ data: { predictionId: id, userId: me, optionIndex: option } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('You already voted on this one.');
      throw error;
    }
    await this.redis.hincrby(countsKey(id), String(option), 1).catch(() => undefined);
    const mine = counts.get(id) ?? row.options.map(() => 0);
    mine[option] = (mine[option] ?? 0) + 1;
    await this.publish({ id, counts: mine, total: mine.reduce((a, b) => a + b, 0) });
    const [onAir, hosts] = await this.liveState();
    const authors = await this.authors([row]);
    return toPrediction(row, mine, { myVote: option, onAir, hosts, authorName: authors.get(row.createdByUserId ?? '') });
  }

  async create(me: string, input: { title: string; options: string[]; minutes: number; category?: PredictionCategory }): Promise<Prediction> {
    const title = input.title.replace(/\s+/g, ' ').trim();
    if (!title || title.length > PREDICTION_LIMITS.titleMax) throw new BadRequestException(`Ask a question (up to ${PREDICTION_LIMITS.titleMax} characters).`);
    const options = [...new Set(input.options.map((o) => o.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    if (options.length < PREDICTION_LIMITS.minOptions || options.length > PREDICTION_LIMITS.maxOptions || options.some((o) => o.length > PREDICTION_LIMITS.optionMax)) {
      throw new BadRequestException(`Give ${PREDICTION_LIMITS.minOptions}–${PREDICTION_LIMITS.maxOptions} different answers (up to ${PREDICTION_LIMITS.optionMax} characters each).`);
    }
    if ([title, ...options].some(containsLink)) throw new BadRequestException("Links aren't allowed in predictions.");
    if (!(PREDICTION_LIMITS.durations as readonly number[]).includes(input.minutes)) throw new BadRequestException('Pick how long it stays open.');
    const rooms = await this.live.list().catch(() => [] as LiveRoom[]);
    const room = rooms.find((r) => r.host.userId === me);
    if (!room && !(await this.isTopTrader(me))) throw new ForbiddenException('Go live, or make this week’s top traders, to ask your own questions.');
    const open = await prisma.prediction.count({ where: { createdByUserId: me, status: 'ACTIVE', expiresAt: { gt: new Date() } } });
    if (open >= MAX_OPEN_PER_USER) throw new BadRequestException(`You have ${MAX_OPEN_PER_USER} open already — let one finish first.`);

    const yesNo = options.length === 2 && options.every((o) => /^(yes|no)$/i.test(o));
    const row = await prisma.prediction.create({
      data: {
        title,
        category: room ? 'streamers' : (input.category ?? 'crypto'),
        kind: yesNo ? 'BINARY' : 'MULTI_CHOICE',
        options,
        resolutionType: room ? 'STREAMER_POLL' : 'MANUAL',
        source: room ? 'STREAMER' : 'USER',
        expiresAt: new Date(Date.now() + input.minutes * 60_000),
        createdByUserId: me,
        liveRoomId: room?.id ?? null,
      },
    });
    const [onAir, hosts] = await this.liveState(rooms);
    const authors = await this.authors([row]);
    const prediction = toPrediction(row, options.map(() => 0), { myVote: null, onAir, hosts, authorName: authors.get(me) });
    await this.redis.publish(PREDICTION_REALTIME_CHANNEL, JSON.stringify({ type: 'created', prediction })).catch(() => undefined);
    return prediction;
  }

  async canCreate(me: string): Promise<boolean> {
    const rooms = await this.live.list().catch(() => [] as LiveRoom[]);
    return rooms.some((r) => r.host.userId === me) || (await this.isTopTrader(me));
  }

  /** Publishes a poll's new counts (and outcome) to every open Predictions page. */
  async publish(update: PredictionUpdate): Promise<void> {
    await this.redis.publish(PREDICTION_REALTIME_CHANNEL, JSON.stringify({ type: 'update', update })).catch(() => undefined);
  }

  private async isTopTrader(me: string): Promise<boolean> {
    const board = await this.leaderboard.getLeaderboard('7d', TOP_TRADERS).catch(() => null);
    return Boolean(board?.entries.some((e) => e.userId === me));
  }

  private async stats(me: string | null): Promise<PredictionsPage['stats']> {
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const [votesToday, active, myVotes] = await Promise.all([
      prisma.predictionVote.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.prediction.count({ where: { status: 'ACTIVE', expiresAt: { gt: new Date() } } }),
      me ? prisma.predictionVote.count({ where: { userId: me } }) : Promise.resolve(0),
    ]);
    return { votesToday, active, myVotes };
  }

  private async present(rows: PredictionRow[], me: string | null): Promise<Prediction[]> {
    if (rows.length === 0) return [];
    const [counts, votes, [onAir, hosts], authors] = await Promise.all([
      this.ensureCounts(rows),
      me ? prisma.predictionVote.findMany({ where: { userId: me, predictionId: { in: rows.map((r) => r.id) } }, select: { predictionId: true, optionIndex: true } }) : Promise.resolve([]),
      this.liveState(),
      this.authors(rows),
    ]);
    const mine = new Map(votes.map((v) => [v.predictionId, v.optionIndex]));
    return rows.map((row) => toPrediction(row, counts.get(row.id) ?? row.options.map(() => 0), { myVote: mine.get(row.id) ?? null, onAir, hosts, authorName: authors.get(row.createdByUserId ?? '') }));
  }

  /** Live counts from Redis; any poll missing there is counted from the votes table and cached. */
  async ensureCounts(rows: Pick<PredictionRow, 'id' | 'options'>[]): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    const missing: Pick<PredictionRow, 'id' | 'options'>[] = [];
    try {
      const pipeline = this.redis.pipeline();
      for (const r of rows) pipeline.hgetall(countsKey(r.id));
      const replies = (await pipeline.exec()) ?? [];
      rows.forEach((r, i) => {
        const hash = replies[i]?.[1] as Record<string, string> | undefined;
        if (hash && Object.keys(hash).length > 0) out.set(r.id, r.options.map((_, j) => Number(hash[String(j)] ?? 0)));
        else missing.push(r);
      });
    } catch {
      missing.push(...rows.filter((r) => !out.has(r.id)));
    }
    if (missing.length > 0) {
      const grouped = await prisma.predictionVote.groupBy({ by: ['predictionId', 'optionIndex'], where: { predictionId: { in: missing.map((r) => r.id) } }, _count: { _all: true } });
      const pipeline = this.redis.pipeline();
      for (const r of missing) {
        const counts = r.options.map((_, j) => grouped.find((g) => g.predictionId === r.id && g.optionIndex === j)?._count._all ?? 0);
        out.set(r.id, counts);
        // The "seed" field keeps an all-zero poll cached too.
        pipeline.hset(countsKey(r.id), { seed: '1', ...Object.fromEntries(counts.map((c, j) => [String(j), String(c)])) });
        pipeline.expire(countsKey(r.id), COUNTS_TTL_SECONDS);
      }
      await pipeline.exec().catch(() => undefined);
    }
    return out;
  }

  private async authors(rows: PredictionRow[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(rows.map((r) => r.createdByUserId).filter((x): x is string => Boolean(x)))];
    if (ids.length === 0) return new Map();
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true } });
    return new Map(users.map((u) => [u.id, u.username]));
  }

  private async liveState(rooms?: LiveRoom[]): Promise<[Set<string>, Map<string, string | null>]> {
    const list = rooms ?? (await this.live.list().catch(() => [] as LiveRoom[]));
    return [new Set(list.map((r) => r.id)), new Map(list.map((r) => [r.id, r.host.username]))];
  }
}
