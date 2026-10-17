import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { prisma, type Duel } from '@kamby/db';
import { DUEL_LIMITS, duelWinner, slugForIdentifier, type DuelSide, type DuelState, type DuelStatus, type DuelTrade, type TokenInfoChain } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits } from 'viem';
import { DmService } from '../dm/dm.service';
import { LivePriceService } from '../market-feeds/live-price.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const PUMPFUN_DECIMALS = 6;
const SWEEP_MS = 20_000;

type BaseState = Omit<DuelState, 'reactions' | 'meId'>;

/** Exported for tests. "+12.4% vs −3.1%" for the result line. */
export function scoreLine(a: number | null, b: number | null): string {
  const f = (x: number | null) => (x === null ? 'no trades' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}%`);
  return `${f(a)} vs ${f(b)}`;
}

/**
 * ⚔️ Duels (2026-10-17) — see @kamby/domain duels.ts. Scores come from the same trade ledger as
 * PnL (TokenLot = buys, RealizedPnlEvent = sells), counting only lots bought inside the duel
 * window. Live state is cached ~3 s (many people watch one duel); a sweep ends duels on time and
 * lets unanswered challenges lapse, even if nobody is looking.
 */
@Injectable()
export class DuelsService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dm: DmService,
    private readonly logger: PinoLogger,
    @Optional() private readonly livePrices?: LivePriceService,
  ) {
    this.logger.setContext('DuelsService');
  }

  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep().catch((error: unknown) => this.logger.warn({ err: error }, 'Duel sweep failed')), SWEEP_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // --- actions ---------------------------------------------------------------------------

  async challenge(me: string, input: { opponentUsername: string; minutes: number; conversationId?: string }): Promise<DuelState> {
    if (!(DUEL_LIMITS.minutes as readonly number[]).includes(input.minutes)) throw new BadRequestException('Pick 5, 15, 30 or 60 minutes.');
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!meUser?.username) throw new ForbiddenException('Set a username in your profile first.');
    const username = input.opponentUsername.replace(/^@/, '').trim().toLowerCase();
    const opponent = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } });
    if (!opponent) throw new NotFoundException('No Kamby user with that name.');
    if (opponent.id === me) throw new BadRequestException("You can't duel yourself.");
    const busy = await prisma.duel.findFirst({
      where: {
        status: { in: ['pending', 'live'] },
        OR: [
          { challengerId: me, opponentId: opponent.id },
          { challengerId: opponent.id, opponentId: me },
        ],
      },
    });
    if (busy) throw new BadRequestException('You two already have a duel going.');
    const ok = await this.redis.set(`kamby:duel:cool:${me}`, '1', 'EX', 20, 'NX').catch(() => 'OK');
    if (ok !== 'OK') throw new HttpException('One challenge at a time — try again in a few seconds.', HttpStatus.TOO_MANY_REQUESTS);

    // Thrown down in a chat both are in, or in your private chat with them.
    let conversationId = input.conversationId ?? null;
    if (conversationId) {
      const { participants } = await this.dm.callAccess(me, conversationId);
      if (!participants.includes(opponent.id)) throw new BadRequestException("They're not in this chat.");
    } else {
      conversationId = (await this.dm.open(me, opponent.username!)).id;
    }
    const duel = await prisma.duel.create({ data: { challengerId: me, opponentId: opponent.id, minutes: input.minutes, conversationId } });
    const message = await this.dm.postDuel(me, conversationId, { duelId: duel.id, minutes: input.minutes });
    await prisma.duel.update({ where: { id: duel.id }, data: { messageId: message.id } });
    return this.get(me, duel.id);
  }

  async accept(me: string, id: string): Promise<DuelState> {
    const duel = await this.find(id);
    if (duel.opponentId !== me) throw new ForbiddenException('Only the challenged trader can accept.');
    if (duel.status !== 'pending' || this.lapsed(duel)) throw new BadRequestException('This challenge is no longer open.');
    const startedAt = new Date();
    const updated = await prisma.duel.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'live', startedAt, endsAt: new Date(startedAt.getTime() + duel.minutes * 60_000) },
    });
    if (updated.count === 0) throw new BadRequestException('This challenge is no longer open.');
    await this.forget(id);
    if (duel.conversationId) {
      await this.dm.notifyDuel(me, duel.conversationId, [duel.challengerId], 'duelAccepted', '', `duel:${id}:on`).catch(() => undefined);
    }
    return this.get(me, id);
  }

  async decline(me: string, id: string): Promise<DuelState> {
    return this.close(me, id, 'opponent', 'declined');
  }

  async cancel(me: string, id: string): Promise<DuelState> {
    return this.close(me, id, 'challenger', 'cancelled');
  }

  async react(me: string, id: string, side: 'challenger' | 'opponent', emoji: string): Promise<Record<string, number>> {
    if (!(DUEL_LIMITS.reactions as readonly string[]).includes(emoji)) throw new BadRequestException('Pick one of the reactions.');
    const duel = await this.find(id);
    if (duel.status !== 'live') throw new BadRequestException('Cheer while the duel is on.');
    const ok = await this.redis.set(`kamby:duel:cheer:${id}:${me}`, '1', 'PX', 500, 'NX').catch(() => 'OK');
    if (ok === 'OK') await this.redis.hincrby(this.reactKey(id, side), emoji, 1).catch(() => 0);
    await this.redis.expire(this.reactKey(id, side), 7 * 86_400).catch(() => 0);
    return this.reactionsOf(id, side);
  }

  // --- reading ---------------------------------------------------------------------------

  async get(me: string | null, id: string): Promise<DuelState> {
    let duel = await this.find(id);
    if (duel.status === 'live' && duel.endsAt && duel.endsAt.getTime() <= Date.now()) duel = await this.finalize(duel);
    if (duel.status === 'pending' && this.lapsed(duel)) duel = await this.expire(duel);
    const base = await this.state(duel);
    const [challenger, opponent] = await Promise.all([this.reactionsOf(id, 'challenger'), this.reactionsOf(id, 'opponent')]);
    return { ...base, reactions: { challenger, opponent }, meId: me };
  }

  private async state(duel: Duel): Promise<BaseState> {
    const key = `kamby:duel:state:${duel.id}`;
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as BaseState;
    const [challenger, opponent] = await Promise.all([this.side(duel, duel.challengerId, duel.challengerPct), this.side(duel, duel.opponentId, duel.opponentPct)]);
    const state: BaseState = {
      id: duel.id,
      conversationId: duel.conversationId,
      status: duel.status as DuelStatus,
      minutes: duel.minutes,
      createdAt: duel.createdAt.toISOString(),
      startedAt: duel.startedAt?.toISOString() ?? null,
      endsAt: duel.endsAt?.toISOString() ?? null,
      expiresAt: new Date(duel.createdAt.getTime() + DUEL_LIMITS.pendingMinutes * 60_000).toISOString(),
      challenger,
      opponent,
      winnerId: duel.winnerId,
    };
    await this.redis.set(key, JSON.stringify(state), 'EX', duel.status === 'live' ? 3 : 60).catch(() => undefined);
    return state;
  }

  private async side(duel: Duel, userId: string, frozenPct: number | null): Promise<DuelSide> {
    const [user, wins] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, avatarUrl: true } }),
      prisma.duel.count({ where: { winnerId: userId } }),
    ]);
    const base = { userId, username: user?.username ?? null, avatarUrl: user?.avatarUrl ?? null, wins };
    if (!duel.startedAt) return { ...base, pct: null, investedUsd: 0, trades: [] };
    const end = duel.status === 'live' ? new Date() : (duel.endsAt ?? new Date());
    const live = await this.score(userId, duel.startedAt, end);
    // A finished duel shows the score it was decided on.
    return { ...base, ...live, pct: duel.status === 'done' ? frozenPct : live.pct };
  }

  /** % PnL on what this person bought in [start, end]. */
  async score(userId: string, start: Date, end: Date): Promise<{ pct: number | null; investedUsd: number; trades: DuelTrade[] }> {
    const lots = await prisma.tokenLot.findMany({
      where: { userId, acquiredAt: { gte: start, lte: end } },
      select: { id: true, evmTokenId: true, solanaMint: true, quantityOriginalRaw: true, costBasisUsd: true, acquiredAt: true },
      orderBy: { acquiredAt: 'desc' },
      take: 200,
    });
    if (lots.length === 0) return { pct: null, investedUsd: 0, trades: [] };
    const events = await prisma.realizedPnlEvent.findMany({
      where: { lotId: { in: lots.map((l) => l.id) }, confirmedAt: { lte: end } },
      select: { lotId: true, proceedsUsd: true, quantityMatchedRaw: true },
    });
    const evmIds = [...new Set(lots.map((l) => l.evmTokenId).filter((x): x is string => Boolean(x)))];
    const mints = [...new Set(lots.map((l) => l.solanaMint).filter((x): x is string => Boolean(x)))];
    const [tokens, listed, pumps] = await Promise.all([
      evmIds.length
        ? prisma.token.findMany({ where: { id: { in: evmIds } }, select: { id: true, contractAddress: true, decimals: true, symbol: true, logoUrl: true, chain: { select: { identifier: true } } } })
        : [],
      mints.length ? prisma.solanaTokenMarket.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, decimals: true, symbol: true, logoUrl: true } }) : [],
      mints.length ? prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true } }) : [],
    ]);
    type Meta = { chainIdentifier: string; address: string; decimals: number | null; symbol: string | null; logoUrl: string | null };
    const meta = new Map<string, Meta>();
    for (const t of tokens) meta.set(`evm:${t.id}`, { chainIdentifier: t.chain.identifier, address: t.contractAddress, decimals: t.decimals, symbol: t.symbol, logoUrl: t.logoUrl });
    for (const m of mints) {
      const l = listed.find((x) => x.mintAddress === m);
      const p = pumps.find((x) => x.mintAddress === m);
      meta.set(`sol:${m}`, { chainIdentifier: 'solana', address: m, decimals: l?.decimals ?? (p ? PUMPFUN_DECIMALS : null), symbol: l?.symbol ?? p?.symbol ?? null, logoUrl: l?.logoUrl ?? null });
    }
    const prices = new Map<string, number | null>();
    for (const [key, m] of meta) prices.set(key, await this.priceOf(m.chainIdentifier, m.address));

    let invested = 0;
    let value = 0;
    const trades: DuelTrade[] = [];
    for (const lot of lots) {
      const key = lot.evmTokenId ? `evm:${lot.evmTokenId}` : `sol:${lot.solanaMint}`;
      const m = meta.get(key);
      const cost = Number(lot.costBasisUsd);
      invested += cost;
      const mine = events.filter((e) => e.lotId === lot.id);
      const sold = mine.reduce((sum, e) => sum + BigInt(e.quantityMatchedRaw), 0n);
      value += mine.reduce((sum, e) => sum + Number(e.proceedsUsd), 0);
      const original = BigInt(lot.quantityOriginalRaw);
      const left = original > sold ? original - sold : 0n;
      const price = prices.get(key) ?? null;
      if (left > 0n) {
        // Unknown price or decimals → the rest counts at cost (neither a win nor a loss).
        value += m?.decimals != null && price !== null ? Number(formatUnits(left, m.decimals)) * price : original > 0n ? cost * (Number(left) / Number(original)) : 0;
      }
      if (m) trades.push({ chainIdentifier: m.chainIdentifier, tokenAddress: m.address, symbol: m.symbol, logoUrl: m.logoUrl, amountUsd: cost, at: lot.acquiredAt.toISOString() });
    }
    return { pct: invested > 0 ? ((value - invested) / invested) * 100 : null, investedUsd: invested, trades: trades.slice(0, 20) };
  }

  private async priceOf(chainIdentifier: string, address: string): Promise<number | null> {
    const chain: TokenInfoChain | null = chainIdentifier === 'solana' ? 'solana' : (slugForIdentifier(chainIdentifier) as TokenInfoChain | null);
    if (chain && this.livePrices) {
      const live = await this.livePrices.price(chain, address).catch(() => null);
      if (live?.priceUsd) return live.priceUsd;
    }
    if (chainIdentifier !== 'solana') {
      const market = await prisma.tokenMarket.findFirst({
        where: { token: { contractAddress: { equals: address, mode: 'insensitive' } }, priceUsd: { not: null } },
        orderBy: { liquidityUsd: 'desc' },
        select: { priceUsd: true },
      });
      if (market?.priceUsd) return Number(market.priceUsd);
    }
    return null;
  }

  // --- lifecycle -------------------------------------------------------------------------

  /** Ends due duels and lapses old challenges — one API instance at a time. */
  private async sweep(): Promise<void> {
    const lock = await this.redis.set('kamby:duel:sweep', '1', 'PX', SWEEP_MS - 2_000, 'NX').catch(() => null);
    if (lock !== 'OK') return;
    const due = await prisma.duel.findMany({ where: { status: 'live', endsAt: { lte: new Date() } }, take: 50 });
    for (const d of due) await this.finalize(d).catch((error: unknown) => this.logger.warn({ err: error, duelId: d.id }, 'Duel finalize failed'));
    const old = await prisma.duel.findMany({ where: { status: 'pending', createdAt: { lt: new Date(Date.now() - DUEL_LIMITS.pendingMinutes * 60_000) } }, take: 100 });
    for (const d of old) await this.expire(d).catch(() => undefined);
  }

  private async finalize(duel: Duel): Promise<Duel> {
    if (!duel.startedAt || !duel.endsAt) return duel;
    const [a, b] = await Promise.all([this.score(duel.challengerId, duel.startedAt, duel.endsAt), this.score(duel.opponentId, duel.startedAt, duel.endsAt)]);
    const winnerId = duelWinner({ userId: duel.challengerId, pct: a.pct }, { userId: duel.opponentId, pct: b.pct });
    const done = await prisma.duel.updateMany({ where: { id: duel.id, status: 'live' }, data: { status: 'done', challengerPct: a.pct, opponentPct: b.pct, winnerId } });
    const fresh = await this.find(duel.id);
    if (done.count === 0) return fresh; // someone else finished it
    await this.forget(duel.id);
    if (duel.conversationId) {
      const people = await prisma.user.findMany({ where: { id: { in: [duel.challengerId, duel.opponentId] } }, select: { id: true, username: true } });
      const name = (id: string) => people.find((p) => p.id === id)?.username ?? 'someone';
      const loserId = winnerId === duel.challengerId ? duel.opponentId : duel.challengerId;
      const line = winnerId
        ? scoreLine(winnerId === duel.challengerId ? a.pct : b.pct, winnerId === duel.challengerId ? b.pct : a.pct)
        : scoreLine(a.pct, b.pct);
      await this.dm
        .postSystem(duel.conversationId, winnerId
          ? { event: 'duelWon', actor: name(winnerId), targets: [name(loserId)], title: line }
          : { event: 'duelDraw', actor: name(duel.challengerId), targets: [name(duel.opponentId)], title: line })
        .catch(() => undefined);
      const preview = winnerId ? `🏆 @${name(winnerId)} won · ${line}` : `🤝 Draw · ${line}`;
      await this.dm.notifyDuel(winnerId ?? duel.challengerId, duel.conversationId, [duel.challengerId, duel.opponentId], 'duelResult', preview, `duel:${duel.id}:done`).catch(() => undefined);
    }
    return fresh;
  }

  private async expire(duel: Duel): Promise<Duel> {
    await prisma.duel.updateMany({ where: { id: duel.id, status: 'pending' }, data: { status: 'expired' } });
    await this.forget(duel.id);
    return this.find(duel.id);
  }

  private async close(me: string, id: string, who: 'challenger' | 'opponent', status: 'declined' | 'cancelled'): Promise<DuelState> {
    const duel = await this.find(id);
    if ((who === 'challenger' ? duel.challengerId : duel.opponentId) !== me) throw new ForbiddenException("That's not yours to do.");
    if (duel.status !== 'pending') throw new BadRequestException('This challenge is no longer open.');
    await prisma.duel.updateMany({ where: { id, status: 'pending' }, data: { status } });
    await this.forget(id);
    return this.get(me, id);
  }

  private lapsed(duel: Duel): boolean {
    return Date.now() - duel.createdAt.getTime() > DUEL_LIMITS.pendingMinutes * 60_000;
  }

  private async find(id: string): Promise<Duel> {
    const duel = await prisma.duel.findUnique({ where: { id } });
    if (!duel) throw new NotFoundException('Duel not found.');
    return duel;
  }

  private forget(id: string): Promise<unknown> {
    return this.redis.del(`kamby:duel:state:${id}`).catch(() => 0);
  }

  private reactKey(id: string, side: 'challenger' | 'opponent'): string {
    return `kamby:duel:react:${id}:${side}`;
  }

  private async reactionsOf(id: string, side: 'challenger' | 'opponent'): Promise<Record<string, number>> {
    const raw = await this.redis.hgetall(this.reactKey(id, side)).catch(() => ({}) as Record<string, string>);
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
  }
}
