import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma } from '@kamby/db';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  MAX_SHOWCASE_TITLES,
  evaluateAchievements,
  type AchievementMetrics,
  type AchievementsDto,
  type ClientAchievementEvent,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { NotificationService } from '../notifications/notification.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { computeAchievementMetrics, type FailedFact, type LotFact, type SellFact, type TradeFact, type VoteFact } from './achievement-metrics';

/** A user is re-evaluated at most this often from page loads. */
const EVAL_COOLDOWN_S = 30;
/** The background pass: who did something in the last few minutes gets evaluated. */
const SWEEP_EVERY_MS = 90_000;
const SWEEP_LOOKBACK_MS = 4 * 60_000;
const SWEEP_MAX_USERS = 300;
const SCARCITY_KEY = 'kamby:ach:scarcity';
const SCARCITY_TTL_S = 10 * 60;
/** At most this many "title unlocked" notifications per evaluation — a big trade can unlock a
 *  handful at once, and nobody wants five pings. The rest are still unlocked, just quiet. */
const MAX_NOTIFY_PER_EVAL = 3;

const CHAIN_BY_ID: Record<number, TradeFact['chain']> = { 8453: 'base', 56: 'bnb', 4663: 'robinhood' };
/** Newest messages read for the chat titles (enough for any real "200 in an hour"). */
const MESSAGE_SCAN = 20_000;
/** A session breaks after this long without a heartbeat from the app. */
const SESSION_GAP_MS = 12 * 60_000;
const clientKey = (userId: string) => `kamby:ach:c:${userId}`;
const chartKey = (userId: string) => `kamby:ach:chart:${userId}`;

/**
 * Achievements & titles (2026-11-01). Progress is recomputed from the user's real rows (trades,
 * P&L, votes, posts, streams…) — see computeAchievementMetrics — and written to
 * UserAchievement, so a title can't be faked and old history counts retroactively.
 *
 * When it runs: on any profile / achievements load (throttled), and every 90s for everyone who
 * just traded, voted on a now-decided poll, posted, got likes, chatted, streamed or duelled —
 * which is the event stream, read from the rows those actions already write. A new unlock
 * creates an ACHIEVEMENT_UNLOCKED notification, which goes out live over the notification
 * stream and as a phone push. A user's very first evaluation is silent (a long-time trader
 * would otherwise get dozens of pings at once).
 */
@Injectable()
export class AchievementsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private kambyStart: Date | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AchievementsService');
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep().catch((err: unknown) => this.logger.warn({ err }, 'Achievements sweep failed')), SWEEP_EVERY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async forMe(userId: string): Promise<AchievementsDto> {
    await this.evaluate(userId).catch((err: unknown) => this.logger.warn({ err, userId }, 'Achievements evaluation failed'));
    return this.dto(userId, true);
  }

  /** Someone's public profile: their unlocked titles only (locked progress is theirs to see). */
  async forUsername(username: string): Promise<AchievementsDto | null> {
    const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() }, select: { id: true } });
    if (!user) return null;
    await this.evaluate(user.id).catch(() => undefined);
    return this.dto(user.id, false);
  }

  /** The title each of these users wears, for badges next to names in chat, Feed and boards. */
  async titles(usernames: string[]): Promise<Record<string, string | null>> {
    const rows = await prisma.user.findMany({
      where: { username: { in: usernames.map((u) => u.toLowerCase()) } },
      select: { username: true, equippedTitleId: true },
    });
    return Object.fromEntries(rows.map((r) => [r.username!, r.equippedTitleId && ACHIEVEMENTS_BY_ID.has(r.equippedTitleId) ? r.equippedTitleId : null]));
  }

  async setTitles(userId: string, input: { equippedTitleId?: string | null; showcaseTitleIds?: string[] }): Promise<AchievementsDto> {
    const unlocked = new Set(
      (await prisma.userAchievement.findMany({ where: { userId, isUnlocked: true }, select: { achievementId: true } })).map((r) => r.achievementId),
    );
    const data: { equippedTitleId?: string | null; showcaseTitleIds?: string[] } = {};
    if (input.equippedTitleId !== undefined) {
      if (input.equippedTitleId !== null && !unlocked.has(input.equippedTitleId)) throw new TitleLockedError();
      data.equippedTitleId = input.equippedTitleId;
    }
    if (input.showcaseTitleIds !== undefined) {
      const ids = [...new Set(input.showcaseTitleIds)].slice(0, MAX_SHOWCASE_TITLES);
      if (ids.some((id) => !unlocked.has(id))) throw new TitleLockedError();
      data.showcaseTitleIds = ids;
    }
    await prisma.user.update({ where: { id: userId }, data });
    return this.dto(userId, true);
  }

  /**
   * What the app reports (2026-11-01, the owner's 50): screen time, chart time, clicks and a few
   * easter eggs the server can't see. Heartbeats count at most once a minute, so leaving more tabs
   * open doesn't speed anything up.
   */
  async clientEvent(userId: string, kind: ClientAchievementEvent, token?: string): Promise<void> {
    const now = Date.now();
    const key = clientKey(userId);
    if (kind === 'session' || kind === 'chart') {
      if ((await this.redis.set(`kamby:ach:beat:${kind}:${userId}`, '1', 'EX', 55, 'NX')) !== 'OK') return;
    }
    if (kind === 'session') {
      const raw = await this.redis.get(`kamby:ach:sess:${userId}`);
      const prev = raw ? (JSON.parse(raw) as { start: number; last: number }) : null;
      const start = prev && now - prev.last <= SESSION_GAP_MS ? prev.start : now;
      await this.redis.set(`kamby:ach:sess:${userId}`, JSON.stringify({ start, last: now }), 'EX', 24 * 3600);
      const hours = Math.floor(((now - start) / 3600_000) * 10) / 10;
      const best = Number((await this.redis.hget(key, 'sessionHours')) ?? 0);
      if (hours > best) await this.redis.hset(key, 'sessionHours', String(hours));
    } else if (kind === 'chart' && token) {
      await this.redis.hincrby(chartKey(userId), token.slice(0, 140), 1);
    } else if (kind === 'chartClick') {
      await this.redis.hincrby(key, 'chartClicks', 1);
    } else if (kind === 'errorReload') {
      await this.redis.hincrby(key, 'errorReloads', 1);
    } else if (kind === 'matrix') {
      await this.redis.hset(key, 'matrixGlitch', '1');
    } else if (kind === 'feedback') {
      await this.redis.hset(key, 'feedbackClicks', '1');
    }
    // The click-type eggs show up right away; heartbeats wait for the next evaluation.
    if (kind !== 'session' && kind !== 'chart') await this.evaluate(userId).catch(() => undefined);
  }

  private async clientMetrics(userId: string): Promise<Partial<AchievementMetrics>> {
    const [c, chart] = await Promise.all([this.redis.hgetall(clientKey(userId)), this.redis.hvals(chartKey(userId))]);
    return {
      sessionHours: Math.floor(Number(c.sessionHours ?? 0)),
      chartHours: Math.floor(Math.max(0, ...chart.map(Number)) / 60),
      chartClicks: Number(c.chartClicks ?? 0),
      errorReloads: Number(c.errorReloads ?? 0),
      matrixGlitch: Number(c.matrixGlitch ?? 0),
      feedbackClicks: Number(c.feedbackClicks ?? 0),
    };
  }

  /** Recompute and store one user's progress. Returns the ids unlocked by this run. */
  async evaluate(userId: string, force = false): Promise<string[]> {
    if (!force && (await this.redis.set(`kamby:ach:eval:${userId}`, '1', 'EX', EVAL_COOLDOWN_S, 'NX')) !== 'OK') return [];
    const metrics = computeAchievementMetrics({ ...(await this.facts(userId)), now: new Date() });
    const results = evaluateAchievements(metrics);
    const existing = new Map(
      (await prisma.userAchievement.findMany({ where: { userId } })).map((r) => [r.achievementId, r]),
    );
    const firstRun = existing.size === 0;
    const now = new Date();
    const newly: string[] = [];
    const writes = [];
    for (const r of results) {
      const row = existing.get(r.id);
      const unlocked = r.unlocked || !!row?.isUnlocked; // once unlocked, always unlocked
      if (!row && r.progress <= 0) continue;
      if (row && row.currentProgress === r.progress && row.isUnlocked === unlocked && row.targetValue === r.target) continue;
      if (unlocked && !row?.isUnlocked) newly.push(r.id);
      writes.push(
        prisma.userAchievement.upsert({
          where: { userId_achievementId: { userId, achievementId: r.id } },
          create: { userId, achievementId: r.id, currentProgress: r.progress, targetValue: r.target, isUnlocked: unlocked, unlockedAt: unlocked ? now : null },
          update: { currentProgress: r.progress, targetValue: r.target, isUnlocked: unlocked, ...(unlocked && !row?.isUnlocked ? { unlockedAt: now } : {}) },
        }),
      );
    }
    if (writes.length) await prisma.$transaction(writes);
    if (!firstRun) {
      // Rarest first: those are the ones worth a ping.
      const order = ['mythic', 'legendary', 'epic', 'rare', 'common'];
      const ping = newly
        .map((id) => ACHIEVEMENTS_BY_ID.get(id)!)
        .sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity))
        .slice(0, MAX_NOTIFY_PER_EVAL);
      for (const a of ping) {
        await this.notifications
          .create({ userId, type: 'ACHIEVEMENT_UNLOCKED', dedupeKey: `ach:${a.id}`, payload: { achievementId: a.id, preview: a.name } })
          .catch((err: unknown) => this.logger.warn({ err, userId }, 'Achievement notification failed'));
      }
    }
    return newly;
  }

  /** Everyone active in the last few minutes (one replica at a time). */
  async sweep(): Promise<void> {
    if ((await this.redis.set('kamby:ach:lock:sweep', '1', 'EX', 80, 'NX')) !== 'OK') return;
    const since = new Date(Date.now() - SWEEP_LOOKBACK_MS);
    const take = SWEEP_MAX_USERS;
    const [evm, sol, pnl, posts, likes, replies, pulse, dms, rooms, duels, launches, decided] = await Promise.all([
      prisma.tradeTransaction.findMany({ where: { confirmedAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.solanaTradeTransaction.findMany({ where: { confirmedAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.realizedPnlEvent.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.feedPost.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.feedLike.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, post: { select: { userId: true } } }, take }),
      prisma.feedReply.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.pulseMessage.findMany({ where: { createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take }),
      prisma.dmMessage.findMany({ where: { createdAt: { gte: since } }, select: { senderId: true }, distinct: ['senderId'], take }),
      prisma.liveRoom.findMany({ where: { OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }] }, select: { hostId: true }, take }),
      prisma.duel.findMany({ where: { status: 'done', endsAt: { gte: since } }, select: { challengerId: true, opponentId: true }, take }),
      prisma.tokenLaunch.findMany({ where: { liveAt: { gte: since } }, select: { userId: true }, take }),
      prisma.prediction.findMany({ where: { resolvedAt: { gte: since } }, select: { votes: { select: { userId: true } } }, take: 50 }),
    ]);
    const ids = new Set<string>([
      ...evm.map((r) => r.userId), ...sol.map((r) => r.userId), ...pnl.map((r) => r.userId), ...posts.map((r) => r.userId),
      ...likes.flatMap((r) => [r.userId, r.post.userId]), ...replies.map((r) => r.userId), ...pulse.map((r) => r.userId),
      ...dms.map((r) => r.senderId), ...rooms.map((r) => r.hostId), ...duels.flatMap((r) => [r.challengerId, r.opponentId ?? '']),
      ...launches.map((r) => r.userId), ...decided.flatMap((p) => p.votes.map((v) => v.userId)),
    ]);
    ids.delete('');
    for (const id of [...ids].slice(0, SWEEP_MAX_USERS)) {
      await this.evaluate(id, true).catch((err: unknown) => this.logger.warn({ err, userId: id }, 'Achievement evaluation failed'));
    }
  }

  private async dto(userId: string, own: boolean): Promise<AchievementsDto> {
    const [user, rows, scarcity] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { equippedTitleId: true, showcaseTitleIds: true } }),
      prisma.userAchievement.findMany({ where: { userId } }),
      this.scarcity(),
    ]);
    const byId = new Map(rows.map((r) => [r.achievementId, r]));
    const achievements = ACHIEVEMENTS.flatMap((a) => {
      const row = byId.get(a.id);
      const unlocked = !!row?.isUnlocked;
      if (!own && !unlocked) return [];
      const counted = scarcity.counts[a.id] ?? 0;
      return [{
        id: a.id,
        unlocked,
        unlockedAt: row?.unlockedAt?.toISOString() ?? null,
        progress: a.secret && !unlocked ? null : (row?.currentProgress ?? 0),
        unlockedCount: counted,
        unlockedPct: scarcity.traders > 0 ? Math.round((counted / scarcity.traders) * 10_000) / 100 : 0,
      }];
    });
    return {
      achievements,
      equippedTitleId: user?.equippedTitleId ?? null,
      showcaseTitleIds: user?.showcaseTitleIds ?? [],
      traders: scarcity.traders,
    };
  }

  /** How many traders hold each title — the "Unlocked by 0.04% of traders" line. */
  private async scarcity(): Promise<{ traders: number; counts: Record<string, number> }> {
    const cached = await this.redis.get(SCARCITY_KEY);
    if (cached) return JSON.parse(cached) as { traders: number; counts: Record<string, number> };
    const [traders, groups] = await Promise.all([
      prisma.user.count({ where: { username: { not: null } } }),
      prisma.userAchievement.groupBy({ by: ['achievementId'], where: { isUnlocked: true }, _count: { _all: true } }),
    ]);
    const value = { traders, counts: Object.fromEntries(groups.map((g) => [g.achievementId, g._count._all])) };
    await this.redis.set(SCARCITY_KEY, JSON.stringify(value), 'EX', SCARCITY_TTL_S);
    return value;
  }

  private async facts(userId: string) {
    const [evm, sol, lots, events, votes, user, evmFailed, solFailed] = await Promise.all([
      prisma.tradeTransaction.findMany({ where: { userId, status: 'CONFIRMED' }, select: { side: true, chainId: true, confirmedAt: true, submittedAt: true } }),
      prisma.solanaTradeTransaction.findMany({ where: { userId, status: 'CONFIRMED' }, select: { side: true, confirmedAt: true, submittedAt: true } }),
      prisma.tokenLot.findMany({ where: { userId }, select: { id: true, evmTokenId: true, solanaMint: true, acquiredAt: true, costBasisUsd: true, quantityOriginalRaw: true } }),
      prisma.realizedPnlEvent.findMany({
        where: { userId },
        select: {
          evmSellTransactionId: true, solanaSellTransactionId: true, evmTokenId: true, solanaMint: true, confirmedAt: true,
          costBasisUsd: true, proceedsUsd: true, realizedPnlUsd: true, quantityMatchedRaw: true, lot: { select: { acquiredAt: true } },
        },
      }),
      prisma.predictionVote.findMany({
        where: { userId },
        select: {
          predictionId: true,
          optionIndex: true,
          prediction: { select: { resolvedOptionIndex: true, resolvedAt: true, options: true, tokenAddress: true, createdAt: true, expiresAt: true } },
        },
      }),
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { createdAt: true, longestStreakDays: true, username: true, avatarUrl: true, equippedTitleId: true } }),
      prisma.tradeTransaction.findMany({ where: { userId, status: 'FAILED' }, select: { side: true, submittedAt: true, tokenMarket: { select: { tokenId: true } } } }),
      prisma.solanaTradeTransaction.findMany({ where: { userId, status: 'FAILED' }, select: { side: true, submittedAt: true, inputMint: true, outputMint: true } }),
    ]);

    const trades: TradeFact[] = [
      ...evm.map((t) => ({ at: t.confirmedAt ?? t.submittedAt, side: sideOf(t.side), chain: CHAIN_BY_ID[t.chainId] ?? ('other' as const) })),
      ...sol.map((t) => ({ at: t.confirmedAt ?? t.submittedAt, side: sideOf(t.side), chain: 'solana' as const })),
    ];
    const lotFacts: LotFact[] = lots.map((l) => ({ id: l.id, token: l.evmTokenId ?? `sol:${l.solanaMint}`, acquiredAt: l.acquiredAt, costUsd: Number(l.costBasisUsd) }));
    const failed: FailedFact[] = [
      ...evmFailed.map((f) => ({ at: f.submittedAt, side: sideOf(f.side), token: f.tokenMarket.tokenId })),
      ...solFailed.map((f) => ({ at: f.submittedAt, side: sideOf(f.side), token: `sol:${sideOf(f.side) === 'BUY' ? f.outputMint : f.inputMint}` })),
    ];
    // Unit prices (USD per raw unit — comparable within one coin) for the price-based titles.
    const sellPrices: { token: string; at: number; price: number }[] = [];
    for (const e of events) {
      const qty = Number(e.quantityMatchedRaw);
      if (qty > 0) sellPrices.push({ token: e.evmTokenId ?? `sol:${e.solanaMint}`, at: e.confirmedAt.getTime(), price: Number(e.proceedsUsd) / qty });
    }
    const myLotPrices = lots
      .map((l) => ({ token: l.evmTokenId ?? `sol:${l.solanaMint}`, at: l.acquiredAt.getTime(), price: Number(l.costBasisUsd) / Number(l.quantityOriginalRaw || 0) }))
      .filter((l) => Number.isFinite(l.price) && l.price > 0);
    const bySell = new Map<string, SellFact>();
    for (const e of events) {
      const key = e.evmSellTransactionId ?? e.solanaSellTransactionId ?? '';
      const held = e.confirmedAt.getTime() - e.lot.acquiredAt.getTime();
      const cur = bySell.get(key);
      if (cur) {
        cur.costUsd += Number(e.costBasisUsd);
        cur.proceedsUsd += Number(e.proceedsUsd);
        cur.pnlUsd += Number(e.realizedPnlUsd);
        cur.heldMs = Math.max(cur.heldMs, held);
      } else {
        bySell.set(key, {
          token: e.evmTokenId ?? `sol:${e.solanaMint}`,
          at: e.confirmedAt,
          costUsd: Number(e.costBasisUsd),
          proceedsUsd: Number(e.proceedsUsd),
          pnlUsd: Number(e.realizedPnlUsd),
          heldMs: held,
        });
      }
    }

    const [pollsCreated, posts, postLikes, tradeCardPosts, replies, likesGiven, pulseMessages, dmMessages, follows, watchlist, theses, referrals, rooms, duels, launches] =
      await Promise.all([
        prisma.prediction.count({ where: { createdByUserId: userId } }),
        prisma.feedPost.count({ where: { userId, hiddenAt: null } }),
        prisma.feedPost.aggregate({ where: { userId, hiddenAt: null }, _sum: { likeCount: true }, _max: { likeCount: true } }),
        prisma.feedPost.count({ where: { userId, hiddenAt: null, kind: { in: ['trade', 'pnl'] } } }),
        prisma.feedReply.count({ where: { userId, hiddenAt: null } }),
        prisma.feedLike.count({ where: { userId } }),
        prisma.pulseMessage.count({ where: { userId, hiddenAt: null } }),
        prisma.dmMessage.count({ where: { senderId: userId } }),
        prisma.follow.count({ where: { userId } }),
        prisma.tokenWatch.count({ where: { userId } }),
        prisma.tokenThesis.count({ where: { userId } }),
        prisma.user.count({ where: { referredByUserId: userId } }),
        prisma.liveRoom.findMany({ where: { hostId: userId }, select: { startedAt: true, endedAt: true, peakViewers: true } }),
        prisma.duel.findMany({ where: { status: 'done', OR: [{ challengerId: userId }, { opponentId: userId }] }, select: { winnerId: true } }),
        prisma.tokenLaunch.count({ where: { userId, status: 'LIVE' } }),
      ]);
    const social = await this.socialFacts(userId);
    const market = await this.marketExtras(lots, myLotPrices, sellPrices);
    const months = new Set([...trades.map((t) => t.at.toISOString().slice(0, 7)), ...social.postMonths]);
    if (!this.kambyStart) this.kambyStart = (await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }))?.createdAt ?? null;
    const equipped = user.equippedTitleId ? ACHIEVEMENTS_BY_ID.get(user.equippedTitleId) : undefined;
    const pollShares = await this.pollShares(votes.map((v) => v.predictionId));
    const now = Date.now();
    // A stream counts for at most 12h, so one left open by accident can't mint "24/7".
    const liveHours = rooms.reduce((a, r) => a + Math.min(12 * 3600_000, (r.endedAt?.getTime() ?? now) - r.startedAt.getTime()), 0) / 3600_000;

    return {
      trades,
      lots: lotFacts,
      sells: [...bySell.values()],
      failed,
      extra: { ...market, communityTop3: social.communityTop3, ...(await this.clientMetrics(userId)) },
      votes: votes.map((v): VoteFact => ({
        correct: v.prediction.resolvedOptionIndex === null ? null : v.prediction.resolvedOptionIndex === v.optionIndex,
        decidedAt: v.prediction.resolvedAt,
        label: v.prediction.options[v.optionIndex] ?? '',
        share: pollShares.get(v.predictionId)?.[v.optionIndex],
        optionIndex: v.optionIndex,
        pollToken: v.prediction.tokenAddress,
        openFrom: v.prediction.createdAt,
        openUntil: v.prediction.expiresAt,
      })),
      other: {
        pollsCreated,
        posts,
        likesReceived: postLikes._sum.likeCount ?? 0,
        maxPostLikes: postLikes._max.likeCount ?? 0,
        tradeCardPosts,
        replies,
        likesGiven,
        pulseMessages,
        dmMessages,
        follows,
        watchlist,
        theses,
        referrals,
        liveStreams: rooms.length,
        peakViewers: Math.max(0, ...rooms.map((r) => r.peakViewers)),
        liveHours,
        duelsPlayed: duels.length,
        duelsWon: duels.filter((d) => d.winnerId === userId).length,
        launches,
        longestStreakDays: user.longestStreakDays,
        createdAt: user.createdAt,
        hasUsername: !!user.username,
        hasAvatar: !!user.avatarUrl,
        followers: social.followers,
        messageTimes: social.messageTimes,
        questionsAsked: social.questions,
        communitiesTalkedIn: social.communities,
        reactionsReceived: social.reactions,
        laughsReceived: social.laughs,
        memePosts: social.memePosts,
        chartPostLikes: social.chartPostLikes,
        equippedRarity: equipped?.rarity ?? null,
        kambyStartAt: this.kambyStart ?? undefined,
        activeMonths: months.size,
      },
    };
  }

  /** Each poll's vote share per answer (0–1). */
  private async pollShares(ids: string[]): Promise<Map<string, number[]>> {
    const out = new Map<string, number[]>();
    if (!ids.length) return out;
    const groups = await prisma.predictionVote.groupBy({ by: ['predictionId', 'optionIndex'], where: { predictionId: { in: ids.slice(0, 2000) } }, _count: { _all: true } });
    const totals = new Map<string, number>();
    for (const g of groups) totals.set(g.predictionId, (totals.get(g.predictionId) ?? 0) + g._count._all);
    for (const g of groups) {
      const arr = out.get(g.predictionId) ?? [];
      arr[g.optionIndex] = g._count._all / (totals.get(g.predictionId) || 1);
      out.set(g.predictionId, arr);
    }
    return out;
  }

  /** Chats, reactions, communities, followers and Feed posts for the social titles. */
  private async socialFacts(userId: string) {
    const [dms, pulse, wallets, posts] = await Promise.all([
      prisma.dmMessage.findMany({ where: { senderId: userId }, orderBy: { createdAt: 'desc' }, take: MESSAGE_SCAN, select: { createdAt: true, body: true, reactions: true, conversationId: true } }),
      prisma.pulseMessage.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: MESSAGE_SCAN, select: { createdAt: true, body: true } }),
      prisma.wallet.findMany({ where: { userId }, select: { address: true } }),
      prisma.feedPost.findMany({ where: { userId, hiddenAt: null }, select: { kind: true, likeCount: true, createdAt: true } }),
    ]);
    let reactions = 0;
    let laughs = 0;
    for (const m of dms) {
      const r = (m.reactions ?? {}) as Record<string, string[]>;
      for (const [emoji, who] of Object.entries(r)) {
        const others = (who ?? []).filter((id) => id !== userId).length;
        reactions += others;
        if (emoji === '😂') laughs += others;
      }
    }
    const convIds = [...new Set(dms.map((m) => m.conversationId))];
    const communities = convIds.length
      ? await prisma.dmConversation.findMany({ where: { id: { in: convIds }, isCommunity: true }, select: { id: true } })
      : [];
    let top3 = 0;
    for (const c of communities.slice(0, 20)) {
      const members = await prisma.dmMember.count({ where: { conversationId: c.id } });
      if (members < 10) continue;
      const leaders = await prisma.dmMessage.groupBy({ by: ['senderId'], where: { conversationId: c.id }, _count: { _all: true }, orderBy: { _count: { senderId: 'desc' } }, take: 3 });
      if (leaders.some((l) => l.senderId === userId)) {
        top3 = 1;
        break;
      }
    }
    const followers = wallets.length ? await prisma.follow.count({ where: { walletAddress: { in: wallets.map((w) => w.address) } } }) : 0;
    return {
      followers,
      messageTimes: [...dms.map((m) => m.createdAt), ...pulse.map((m) => m.createdAt)],
      questions: [...dms, ...pulse].filter((m) => m.body.includes('?')).length,
      communities: communities.length,
      communityTop3: top3,
      reactions,
      laughs,
      memePosts: posts.filter((p) => p.kind === 'photo' || p.kind === 'chart' || p.kind === 'video').length,
      chartPostLikes: posts.filter((p) => p.kind === 'chart').map((p) => p.likeCount),
      postMonths: posts.map((p) => p.createdAt.toISOString().slice(0, 7)),
    };
  }

  /** Titles that compare against everyone's buys on Kamby: early apes, tops bought, sells before a pump. */
  private async marketExtras(
    lots: { evmTokenId: string | null; solanaMint: string | null; acquiredAt: Date }[],
    mine: { token: string; at: number; price: number }[],
    sells: { token: string; at: number; price: number }[],
  ): Promise<Partial<AchievementMetrics>> {
    const mints = [...new Set(lots.map((l) => l.solanaMint).filter((m): m is string => !!m))].slice(0, 500);
    const launched = mints.length ? await prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, createdAt: true } }) : [];
    const launchAt = new Map(launched.map((p) => [p.mintAddress, p.createdAt.getTime()]));
    const apeBuys = lots.filter((l) => l.solanaMint && launchAt.has(l.solanaMint) && l.acquiredAt.getTime() - launchAt.get(l.solanaMint)! <= 10 * 60_000).length;

    const tokens = [...new Set([...mine, ...sells].map((x) => x.token))].slice(0, 200);
    const evmIds = tokens.filter((t) => !t.startsWith('sol:'));
    const solMints = tokens.filter((t) => t.startsWith('sol:')).map((t) => t.slice(4));
    const all = tokens.length
      ? await prisma.tokenLot.findMany({
          where: { OR: [{ evmTokenId: { in: evmIds } }, { solanaMint: { in: solMints } }] },
          select: { evmTokenId: true, solanaMint: true, acquiredAt: true, costBasisUsd: true, quantityOriginalRaw: true },
          take: 50_000,
        })
      : [];
    const byToken = new Map<string, { at: number; price: number }[]>();
    for (const l of all) {
      const price = Number(l.costBasisUsd) / Number(l.quantityOriginalRaw || 0);
      if (!Number.isFinite(price) || price <= 0) continue;
      const key = l.evmTokenId ?? `sol:${l.solanaMint}`;
      (byToken.get(key) ?? byToken.set(key, []).get(key)!).push({ at: l.acquiredAt.getTime(), price });
    }
    let athBuys = 0;
    for (const m of mine) {
      const list = byToken.get(m.token) ?? [];
      if (list.length < 5) continue;
      const max = Math.max(...list.map((x) => x.price));
      if (m.price >= max * 0.999 && list.some((x) => x.at > m.at && x.price <= max * 0.8)) athBuys += 1;
    }
    let shadowSells = 0;
    for (const s of sells) {
      const list = byToken.get(s.token) ?? [];
      if (list.some((x) => x.at > s.at && x.at - s.at <= 10 * 60_000 && x.price >= s.price * 1.2)) shadowSells += 1;
    }
    return { apeBuys, athBuys, shadowSells };
  }
}

function sideOf(side: string): 'BUY' | 'SELL' {
  return side.toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

export class TitleLockedError extends Error {
  constructor() {
    super('That title is not unlocked yet');
  }
}
