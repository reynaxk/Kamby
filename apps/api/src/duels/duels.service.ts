import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common';
import { prisma, type Duel } from '@kamby/db';
import { DUEL_LIMITS, duelWinner, slugForIdentifier, type DuelLeader, type DuelSide, type DuelState, type DuelStatus, type DuelTrade, type TokenInfoChain } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits } from 'viem';
import { DmService } from '../dm/dm.service';
import { LivePriceService } from '../market-feeds/live-price.service';
import { evmBuyFeeBps, solanaBuyFees } from '../social/services/position.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const PUMPFUN_DECIMALS = 6;
const SWEEP_MS = 20_000;
const OPEN_LIST_KEY = 'kamby:duel:open';

type BaseState = Omit<DuelState, 'reactions' | 'meId'>;

/** The empty side of an open duel nobody has joined yet. */
const NOBODY: DuelSide = { userId: '', username: null, avatarUrl: null, pct: null, investedUsd: 0, trades: [], wins: 0 };

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

  /** An open duel (2026-10-18): thrown into the lobby for anyone to take — no opponent yet. */
  async openDuel(me: string, minutes: number): Promise<DuelState> {
    if (!(DUEL_LIMITS.minutes as readonly number[]).includes(minutes)) throw new BadRequestException('Pick 5, 15, 30 or 60 minutes.');
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!meUser?.username) throw new ForbiddenException('Set a username in your profile first.');
    const mine = await prisma.duel.findFirst({ where: { challengerId: me, status: 'open', createdAt: { gt: new Date(Date.now() - DUEL_LIMITS.openMinutes * 60_000) } } });
    if (mine) throw new BadRequestException('You already have an open duel waiting.');
    const ok = await this.redis.set(`kamby:duel:cool:${me}`, '1', 'EX', 20, 'NX').catch(() => 'OK');
    if (ok !== 'OK') throw new HttpException('One challenge at a time — try again in a few seconds.', HttpStatus.TOO_MANY_REQUESTS);
    const duel = await prisma.duel.create({ data: { challengerId: me, opponentId: null, minutes, status: 'open' } });
    await this.redis.del(OPEN_LIST_KEY).catch(() => 0);
    return this.get(me, duel.id);
  }

  /** Take an open duel: it starts at once, and its card lands in your private chat with them. */
  async join(me: string, id: string): Promise<DuelState> {
    const duel = await this.find(id);
    if (duel.status !== 'open' || this.lapsed(duel)) throw new BadRequestException('This duel is no longer open.');
    if (duel.challengerId === me) throw new BadRequestException("You can't duel yourself.");
    const meUser = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!meUser?.username) throw new ForbiddenException('Set a username in your profile first.');
    const startedAt = new Date();
    const taken = await prisma.duel.updateMany({
      where: { id, status: 'open', opponentId: null },
      data: { opponentId: me, status: 'live', startedAt, endsAt: new Date(startedAt.getTime() + duel.minutes * 60_000) },
    });
    if (taken.count === 0) throw new BadRequestException('Someone else just took this duel.');
    await Promise.all([this.forget(id), this.redis.del(OPEN_LIST_KEY).catch(() => 0)]);
    const challenger = await prisma.user.findUnique({ where: { id: duel.challengerId }, select: { username: true } });
    if (challenger?.username) {
      const conversationId = (await this.dm.open(me, challenger.username).catch(() => null))?.id ?? null;
      if (conversationId) {
        const message = await this.dm.postDuel(me, conversationId, { duelId: id, minutes: duel.minutes }).catch(() => null);
        await prisma.duel.update({ where: { id }, data: { conversationId, messageId: message?.id ?? null } });
        await this.dm.notifyDuel(me, conversationId, [duel.challengerId], 'duelAccepted', '', `duel:${id}:on`).catch(() => undefined);
        await this.forget(id);
      }
    }
    return this.get(me, id);
  }

  /** The lobby: open duels still waiting, newest first. */
  async listOpen(me: string | null): Promise<DuelState[]> {
    const ids = await this.cachedOpenIds();
    const states = await Promise.all(ids.map((id) => this.get(me, id).catch(() => null)));
    return states.filter((d): d is DuelState => d !== null && d.status === 'open');
  }

  private async cachedOpenIds(): Promise<string[]> {
    const hit = await this.redis.get(OPEN_LIST_KEY).catch(() => null);
    if (hit) return JSON.parse(hit) as string[];
    const rows = await prisma.duel.findMany({
      where: { status: 'open', createdAt: { gt: new Date(Date.now() - DUEL_LIMITS.openMinutes * 60_000) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    await this.redis.set(OPEN_LIST_KEY, JSON.stringify(ids), 'EX', 5).catch(() => undefined);
    return ids;
  }

  /** This month's top duelists: wins, duels played and the current winning streak. */
  async leaders(limit = 20): Promise<DuelLeader[]> {
    const now = new Date();
    const key = `kamby:duel:leaders:${now.toISOString().slice(0, 7)}`;
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as DuelLeader[];
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const wins = await prisma.duel.groupBy({
      by: ['winnerId'],
      where: { status: 'done', winnerId: { not: null }, endsAt: { gte: monthStart } },
      _count: { _all: true },
      orderBy: { _count: { winnerId: 'desc' } },
      take: limit,
    });
    const ids = wins.map((w) => w.winnerId).filter((x): x is string => Boolean(x));
    const [users, recent] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatarUrl: true } }),
      prisma.duel.findMany({
        where: { status: 'done', endsAt: { gte: monthStart }, OR: [{ challengerId: { in: ids } }, { opponentId: { in: ids } }] },
        orderBy: { endsAt: 'desc' },
        select: { challengerId: true, opponentId: true, winnerId: true },
        take: 2000,
      }),
    ]);
    const leaders: DuelLeader[] = ids.map((id) => {
      const theirs = recent.filter((d) => d.challengerId === id || d.opponentId === id);
      let streak = 0;
      for (const d of theirs) {
        if (d.winnerId !== id) break;
        streak++;
      }
      const u = users.find((x) => x.id === id);
      return { userId: id, username: u?.username ?? null, avatarUrl: u?.avatarUrl ?? null, wins: wins.find((w) => w.winnerId === id)?._count._all ?? 0, played: theirs.length, streak };
    });
    await this.redis.set(key, JSON.stringify(leaders), 'EX', 60).catch(() => undefined);
    return leaders;
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
    if ((duel.status === 'pending' || duel.status === 'open') && this.lapsed(duel)) duel = await this.expire(duel);
    const base = await this.state(duel);
    const [challenger, opponent] = await Promise.all([this.reactionsOf(id, 'challenger'), this.reactionsOf(id, 'opponent')]);
    return { ...base, reactions: { challenger, opponent }, meId: me };
  }

  private async state(duel: Duel): Promise<BaseState> {
    const key = `kamby:duel:state:${duel.id}`;
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as BaseState;
    const [challenger, opponent] = await Promise.all([
      this.side(duel, duel.challengerId, duel.challengerPct),
      duel.opponentId ? this.side(duel, duel.opponentId, duel.opponentPct) : Promise.resolve(NOBODY),
    ]);
    const state: BaseState = {
      id: duel.id,
      conversationId: duel.conversationId,
      status: duel.status as DuelStatus,
      minutes: duel.minutes,
      createdAt: duel.createdAt.toISOString(),
      startedAt: duel.startedAt?.toISOString() ?? null,
      endsAt: duel.endsAt?.toISOString() ?? null,
      expiresAt: new Date(duel.createdAt.getTime() + (duel.status === 'open' ? DUEL_LIMITS.openMinutes : DUEL_LIMITS.pendingMinutes) * 60_000).toISOString(),
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
      select: { id: true, evmTokenId: true, solanaMint: true, quantityOriginalRaw: true, costBasisUsd: true, acquiredAt: true, evmBuyTransactionId: true, solanaBuyTransactionId: true },
      orderBy: { acquiredAt: 'desc' },
      take: 200,
    });
    if (lots.length === 0) return { pct: null, investedUsd: 0, trades: [] };
    // Coins this player launched on Kamby's LaunchPad never count — they could pump their own coin.
    const launched = new Set(
      (await prisma.tokenLaunch.findMany({ where: { userId, tokenAddress: { not: null } }, select: { tokenAddress: true } })).map((l) => (l.tokenAddress ?? '').toLowerCase()),
    );
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
    // Score what went into the coin, not Kamby's fee (2026-10-18, real duel: the same $2 CAKE buy
    // read -0.26% on its trade card but -4.25% in the duel — small trades started 4% down).
    const [evmFeeBps, solanaFees] = await Promise.all([
      evmBuyFeeBps(lots.map((l) => l.evmBuyTransactionId).filter((id): id is string => id !== null)),
      solanaBuyFees(lots.map((l) => l.solanaBuyTransactionId).filter((id): id is string => id !== null)),
    ]);
    const prices = new Map<string, number | null>();
    for (const [key, m] of meta) prices.set(key, await this.priceOf(m.chainIdentifier, m.address));

    let invested = 0;
    let paidIn = 0; // what they put in, fee included — shown as "$2.00 in"
    let value = 0;
    const trades: DuelTrade[] = [];
    for (const lot of lots) {
      const key = lot.evmTokenId ? `evm:${lot.evmTokenId}` : `sol:${lot.solanaMint}`;
      const m = meta.get(key);
      if ((m && launched.has(m.address.toLowerCase())) || (lot.solanaMint && launched.has(lot.solanaMint.toLowerCase()))) continue;
      const gross = Number(lot.costBasisUsd);
      const fee = lot.evmBuyTransactionId
        ? gross * ((evmFeeBps.get(lot.evmBuyTransactionId) ?? 0) / 10_000)
        : lot.solanaBuyTransactionId
          ? (solanaFees.get(lot.solanaBuyTransactionId) ?? 0)
          : 0;
      const cost = Math.max(0, gross - Math.min(fee, gross));
      invested += cost;
      paidIn += gross;
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
      if (m) trades.push({ chainIdentifier: m.chainIdentifier, tokenAddress: m.address, symbol: m.symbol, logoUrl: m.logoUrl, amountUsd: gross, at: lot.acquiredAt.toISOString() });
    }
    if (paidIn === 0) return { pct: null, investedUsd: 0, trades: [] };
    return { pct: invested > 0 ? ((value - invested) / invested) * 100 : null, investedUsd: paidIn, trades: trades.slice(0, 20) };
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
    const old = await prisma.duel.findMany({
      where: {
        OR: [
          { status: 'pending', createdAt: { lt: new Date(Date.now() - DUEL_LIMITS.pendingMinutes * 60_000) } },
          { status: 'open', createdAt: { lt: new Date(Date.now() - DUEL_LIMITS.openMinutes * 60_000) } },
        ],
      },
      take: 100,
    });
    for (const d of old) await this.expire(d).catch(() => undefined);
  }

  private async finalize(duel: Duel): Promise<Duel> {
    if (!duel.startedAt || !duel.endsAt || !duel.opponentId) return duel;
    const opponentId = duel.opponentId;
    const [a, b] = await Promise.all([this.score(duel.challengerId, duel.startedAt, duel.endsAt), this.score(opponentId, duel.startedAt, duel.endsAt)]);
    const winnerId = duelWinner({ userId: duel.challengerId, pct: a.pct }, { userId: opponentId, pct: b.pct });
    const done = await prisma.duel.updateMany({ where: { id: duel.id, status: 'live' }, data: { status: 'done', challengerPct: a.pct, opponentPct: b.pct, winnerId } });
    const fresh = await this.find(duel.id);
    if (done.count === 0) return fresh; // someone else finished it
    await this.forget(duel.id);
    if (duel.conversationId) {
      const people = await prisma.user.findMany({ where: { id: { in: [duel.challengerId, opponentId] } }, select: { id: true, username: true } });
      const name = (id: string) => people.find((p) => p.id === id)?.username ?? 'someone';
      const loserId = winnerId === duel.challengerId ? opponentId : duel.challengerId;
      const line = winnerId
        ? scoreLine(winnerId === duel.challengerId ? a.pct : b.pct, winnerId === duel.challengerId ? b.pct : a.pct)
        : scoreLine(a.pct, b.pct);
      await this.dm
        .postSystem(duel.conversationId, winnerId
          ? { event: 'duelWon', actor: name(winnerId), targets: [name(loserId)], title: line }
          : { event: 'duelDraw', actor: name(duel.challengerId), targets: [name(opponentId)], title: line })
        .catch(() => undefined);
      const preview = winnerId ? `🏆 @${name(winnerId)} won · ${line}` : `🤝 Draw · ${line}`;
      await this.dm.notifyDuel(winnerId ?? duel.challengerId, duel.conversationId, [duel.challengerId, opponentId], 'duelResult', preview, `duel:${duel.id}:done`).catch(() => undefined);
    }
    return fresh;
  }

  private async expire(duel: Duel): Promise<Duel> {
    await prisma.duel.updateMany({ where: { id: duel.id, status: { in: ['pending', 'open'] } }, data: { status: 'expired' } });
    await this.forget(duel.id);
    return this.find(duel.id);
  }

  private async close(me: string, id: string, who: 'challenger' | 'opponent', status: 'declined' | 'cancelled'): Promise<DuelState> {
    const duel = await this.find(id);
    if ((who === 'challenger' ? duel.challengerId : duel.opponentId) !== me) throw new ForbiddenException("That's not yours to do.");
    const openOk = duel.status === 'open' && who === 'challenger';
    if (duel.status !== 'pending' && !openOk) throw new BadRequestException('This challenge is no longer open.');
    await prisma.duel.updateMany({ where: { id, status: { in: ['pending', 'open'] } }, data: { status } });
    await Promise.all([this.forget(id), this.redis.del(OPEN_LIST_KEY).catch(() => 0)]);
    return this.get(me, id);
  }

  private lapsed(duel: Duel): boolean {
    return Date.now() - duel.createdAt.getTime() > (duel.status === 'open' ? DUEL_LIMITS.openMinutes : DUEL_LIMITS.pendingMinutes) * 60_000;
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
