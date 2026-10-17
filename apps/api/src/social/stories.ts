import { Controller, Get, Inject, Injectable, Optional, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { prisma } from '@kamby/db';
import { STORY_LIMITS, type StoryCard, type StoryPerson } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { CurrentUser } from '../identity/current-user.decorator';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const CACHE_KEY = 'kamby:stories:v1';
const CACHE_SECONDS = 60;

interface Group {
  userId: string;
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  logoUrl: string | null;
  pnlUsd: number;
  costUsd: number;
  at: Date;
}

/** Exported for tests. Wins → one card per (person, coin), people ordered: followed first,
 *  then by their best day. */
export function buildStories(
  groups: Group[],
  people: Map<string, { username: string; avatarUrl: string | null; walletAddress: string | null }>,
  followed: Set<string>,
  day: string,
): StoryPerson[] {
  const byUser = new Map<string, Group[]>();
  for (const g of groups) if (g.pnlUsd > 0 && people.has(g.userId)) byUser.set(g.userId, [...(byUser.get(g.userId) ?? []), g]);
  const out: StoryPerson[] = [];
  for (const [userId, list] of byUser) {
    const p = people.get(userId)!;
    const cards: StoryCard[] = list
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, STORY_LIMITS.maxPerPerson)
      .map((g) => ({
        id: `${userId}:${g.chainIdentifier}:${g.tokenAddress}:${day}`,
        chainIdentifier: g.chainIdentifier,
        tokenAddress: g.tokenAddress,
        symbol: g.symbol,
        logoUrl: g.logoUrl,
        pnlUsd: g.pnlUsd,
        pnlPct: g.costUsd > 0 ? (g.pnlUsd / g.costUsd) * 100 : 0,
        investedUsd: g.costUsd,
        at: g.at.toISOString(),
      }));
    out.push({ userId, username: p.username, avatarUrl: p.avatarUrl, walletAddress: p.walletAddress, followed: followed.has(userId), cards, latestAt: cards[0]!.at });
  }
  const best = (s: StoryPerson) => s.cards.reduce((n, c) => n + c.pnlUsd, 0);
  return out.sort((a, b) => Number(b.followed) - Number(a.followed) || best(b) - best(a)).slice(0, STORY_LIMITS.maxPeople);
}

@Injectable()
export class StoriesService {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis) {}

  async list(viewerId: string | null): Promise<StoryPerson[]> {
    const all = await this.everyone();
    if (!viewerId || all.length === 0) return all;
    const follows = await prisma.follow.findMany({ where: { userId: viewerId, wallet: { userId: { in: all.map((s) => s.userId) } } }, select: { wallet: { select: { userId: true } } } });
    const followed = new Set(follows.map((f) => f.wallet.userId).filter((x): x is string => Boolean(x)));
    return all
      .map((s) => ({ ...s, followed: followed.has(s.userId) }))
      .sort((a, b) => Number(b.followed) - Number(a.followed));
  }

  /** Everyone's stories (no viewer) — the same for all, cached a minute. */
  private async everyone(): Promise<StoryPerson[]> {
    const cached = await this.redis?.get(CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as StoryPerson[];
    const since = new Date(Date.now() - STORY_LIMITS.windowHours * 3600_000);
    const events = await prisma.realizedPnlEvent.findMany({
      where: { confirmedAt: { gte: since } },
      select: {
        userId: true,
        solanaMint: true,
        realizedPnlUsd: true,
        costBasisUsd: true,
        confirmedAt: true,
        evmToken: { select: { contractAddress: true, symbol: true, logoUrl: true, chain: { select: { identifier: true } } } },
      },
      take: 5000,
    });
    const mints = [...new Set(events.map((e) => e.solanaMint).filter((m): m is string => Boolean(m)))];
    const solana = mints.length
      ? await prisma.solanaTokenMarket.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true, logoUrl: true } })
      : [];
    const pump = mints.length ? await prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true } }) : [];
    const solMeta = new Map<string, { symbol: string | null; logoUrl: string | null }>();
    for (const p of pump) solMeta.set(p.mintAddress, { symbol: p.symbol, logoUrl: null });
    for (const s of solana) solMeta.set(s.mintAddress, { symbol: s.symbol, logoUrl: s.logoUrl });

    const groups = new Map<string, Group>();
    for (const e of events) {
      const chainIdentifier = e.solanaMint ? 'solana' : e.evmToken?.chain.identifier;
      const tokenAddress = e.solanaMint ?? e.evmToken?.contractAddress;
      if (!chainIdentifier || !tokenAddress) continue;
      const key = `${e.userId}|${chainIdentifier}|${tokenAddress}`;
      const meta = e.solanaMint ? solMeta.get(e.solanaMint) : { symbol: e.evmToken?.symbol ?? null, logoUrl: e.evmToken?.logoUrl ?? null };
      const g = groups.get(key) ?? { userId: e.userId, chainIdentifier, tokenAddress, symbol: meta?.symbol ?? null, logoUrl: meta?.logoUrl ?? null, pnlUsd: 0, costUsd: 0, at: e.confirmedAt };
      g.pnlUsd += Number(e.realizedPnlUsd);
      g.costUsd += Number(e.costBasisUsd);
      if (e.confirmedAt > g.at) g.at = e.confirmedAt;
      groups.set(key, g);
    }
    const userIds = [...new Set([...groups.values()].filter((g) => g.pnlUsd > 0).map((g) => g.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds }, username: { not: null } },
          select: { id: true, username: true, avatarUrl: true, wallets: { where: { verifiedAt: { not: null } }, select: { address: true }, orderBy: { verifiedAt: 'asc' }, take: 1 } },
        })
      : [];
    const people = new Map(users.map((u) => [u.id, { username: u.username!, avatarUrl: u.avatarUrl, walletAddress: u.wallets[0]?.address ?? null }]));
    const stories = buildStories([...groups.values()], people, new Set(), new Date().toISOString().slice(0, 10));
    await this.redis?.set(CACHE_KEY, JSON.stringify(stories), 'EX', CACHE_SECONDS).catch(() => undefined);
    return stories;
  }
}

/** Stories (2026-10-17): public; a signed-in viewer sees people they follow first. */
@Controller('social/stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard)
  @Get()
  list(@CurrentUser() user: SessionUser | null) {
    return this.stories.list(user?.id ?? null);
  }
}
