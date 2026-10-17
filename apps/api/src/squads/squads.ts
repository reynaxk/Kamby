import { Controller, Get, HttpCode, Inject, Injectable, Optional, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional } from 'class-validator';
import { prisma, Prisma } from '@kamby/db';
import { SQUAD_LIMITS, type SquadBoard, type SquadSort, type SquadSummary, type SquadTopToken } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { DmService } from '../dm/dm.service';
import { REDIS_CLIENT } from '../redis/redis.module';

type Ranked = Omit<SquadSummary, 'rank' | 'joined'>;

/** Exported for tests. Volume: biggest first. Win rate: squads with enough closed trades first,
 *  best rate first, volume breaks ties. */
export function rankSquads(rows: Ranked[], sort: SquadSort): Ranked[] {
  const list = [...rows];
  if (sort === 'volume') return list.sort((a, b) => b.volumeUsd - a.volumeUsd || b.memberCount - a.memberCount);
  const qualifies = (r: Ranked) => r.winRate !== null && r.closedTrades >= SQUAD_LIMITS.minClosedForWinRate;
  return list.sort((a, b) => Number(qualifies(b)) - Number(qualifies(a)) || (b.winRate ?? -1) - (a.winRate ?? -1) || b.volumeUsd - a.volumeUsd);
}

const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Squad Wars (2026-10-17) — see @kamby/domain squads.ts. Month-to-date numbers from the same
 * ledger the PnL and leaderboards use (TokenLot = buys, RealizedPnlEvent = sells / closed
 * trades), cached for a few minutes as one list.
 */
@Injectable()
export class SquadsService {
  constructor(
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly dm: DmService,
  ) {}

  async board(me: string | null, sort: SquadSort): Promise<SquadBoard> {
    const month = monthKey();
    const rows = await this.cached(month);
    const ranked = rankSquads(rows, sort);
    const mine = me
      ? new Set(
          (await prisma.dmMember.findMany({ where: { userId: me, status: 'active', conversationId: { in: ranked.map((r) => r.conversationId) } }, select: { conversationId: true } })).map(
            (m) => m.conversationId,
          ),
        )
      : new Set<string>();
    return { month, sort, squads: ranked.map((r, i) => ({ ...r, rank: i + 1, joined: mine.has(r.conversationId) })) };
  }

  private async cached(month: string): Promise<Ranked[]> {
    const key = `kamby:squads:board:${month}`;
    const hit = await this.redis?.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as Ranked[];
    const rows = await this.compute();
    await this.redis?.set(key, JSON.stringify(rows), 'EX', SQUAD_LIMITS.cacheSeconds).catch(() => undefined);
    return rows;
  }

  private async compute(): Promise<Ranked[]> {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const squads = await prisma.dmConversation.findMany({
      where: { isCommunity: true, visibility: { in: ['gated', 'public'] } },
      select: { id: true, title: true, about: true, visibility: true, members: { where: { status: 'active' }, select: { userId: true } } },
      take: 200,
    });
    const out: Ranked[] = [];
    for (const s of squads) {
      const users = s.members.map((m) => m.userId);
      if (users.length === 0) continue;
      const [buys, sells, wins, evmSwaps, solSwaps, top] = await Promise.all([
        prisma.tokenLot.aggregate({ where: { userId: { in: users }, acquiredAt: { gte: monthStart } }, _sum: { costBasisUsd: true } }),
        prisma.realizedPnlEvent.aggregate({ where: { userId: { in: users }, confirmedAt: { gte: monthStart } }, _sum: { proceedsUsd: true }, _count: true }),
        prisma.realizedPnlEvent.count({ where: { userId: { in: users }, confirmedAt: { gte: monthStart }, realizedPnlUsd: { gt: 0 } } }),
        prisma.tradeTransaction.count({ where: { userId: { in: users }, status: 'CONFIRMED', createdAt: { gte: monthStart } } }),
        prisma.solanaTradeTransaction.count({ where: { userId: { in: users }, status: 'CONFIRMED', createdAt: { gte: monthStart } } }),
        prisma.tokenLot.groupBy({
          by: ['evmTokenId', 'solanaMint'],
          where: { userId: { in: users }, acquiredAt: { gte: weekAgo } },
          _sum: { costBasisUsd: true },
          orderBy: { _sum: { costBasisUsd: 'desc' } },
          take: 1,
        }),
      ]);
      const closed = sells._count;
      out.push({
        conversationId: s.id,
        title: s.title ?? 'Squad',
        about: s.about,
        visibility: s.visibility === 'public' ? 'public' : 'gated',
        memberCount: users.length,
        volumeUsd: num(buys._sum.costBasisUsd) + num(sells._sum.proceedsUsd),
        swaps: evmSwaps + solSwaps,
        winRate: closed > 0 ? wins / closed : null,
        closedTrades: closed,
        topToken: top[0] ? await this.token(top[0].evmTokenId, top[0].solanaMint) : null,
      });
    }
    return out;
  }

  private async token(evmTokenId: string | null, solanaMint: string | null): Promise<SquadTopToken | null> {
    if (evmTokenId) {
      const t = await prisma.token.findUnique({ where: { id: evmTokenId }, select: { contractAddress: true, symbol: true, logoUrl: true, chain: { select: { identifier: true } } } });
      return t ? { chainIdentifier: t.chain.identifier, tokenAddress: t.contractAddress, symbol: t.symbol, logoUrl: t.logoUrl } : null;
    }
    if (solanaMint) {
      const [m, p] = await Promise.all([
        prisma.solanaTokenMarket.findUnique({ where: { mintAddress: solanaMint }, select: { symbol: true, logoUrl: true } }),
        prisma.pumpFunToken.findUnique({ where: { mintAddress: solanaMint }, select: { symbol: true } }),
      ]);
      return { chainIdentifier: 'solana', tokenAddress: solanaMint, symbol: m?.symbol ?? p?.symbol ?? null, logoUrl: m?.logoUrl ?? null };
    }
    return null;
  }

  join(me: string, id: string) {
    return this.dm.joinListedSquad(me, id);
  }

  requestInvite(me: string, id: string) {
    return this.dm.requestSquadInvite(me, id);
  }
}

function num(d: Prisma.Decimal | null | undefined): number {
  return d ? Number(d) : 0;
}

class BoardQueryDto {
  @IsOptional()
  @IsIn(['volume', 'winrate'])
  sort?: SquadSort;
}

@Controller('squads')
export class SquadsController {
  constructor(private readonly squads: SquadsService) {}

  /** The ranking — anyone can look. */
  @UseGuards(OptionalAuthGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get()
  board(@Query() query: BoardQueryDto, @CurrentUser() user: SessionUser | null) {
    return this.squads.board(user?.id ?? null, query.sort ?? 'volume');
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/join')
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.squads.join(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post(':id/request')
  request(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: SessionUser) {
    return this.squads.requestInvite(user.id, id);
  }
}
