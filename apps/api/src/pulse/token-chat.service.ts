import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { prisma, type Prisma } from '@kamby/db';
import {
  chatTokenKey,
  containsLink,
  isChatTokenKey,
  isTokenChatReaction,
  normalizePulseBody,
  PULSE_LIMITS,
  TOKEN_CHAT_LIMITS,
  TOKEN_CHAT_REALTIME_CHANNEL,
  type TokenChatBadge,
  type TokenChatEvent,
  type TokenChatItem,
  type TokenChatPnl,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';
import { LeaderboardService } from '../social/services/leaderboard.service';
import { PositionService } from '../social/services/position.service';
import { TRANSACTION_INCLUDE, toDto } from '../trading/transaction-dto';

const AUTHOR_SELECT = {
  username: true,
  avatarUrl: true,
  wallets: { where: { verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' }, take: 1, select: { address: true } },
} satisfies Prisma.UserSelect;

type AuthorRow = Prisma.UserGetPayload<{ select: typeof AUTHOR_SELECT }>;
type MessageRow = Prisma.PulseMessageGetPayload<{ include: { user: { select: typeof AUTHOR_SELECT } } }>;

function author(user: AuthorRow) {
  return { username: user.username, avatarUrl: user.avatarUrl, address: user.wallets[0]?.address ?? null };
}

function badgesOf(raw: string[]): TokenChatBadge[] {
  return raw.filter((b): b is TokenChatBadge => b === 'whale' || b === 'top' || b === 'dev');
}

export function messageItem(row: MessageRow): TokenChatItem {
  const base = { id: row.id, tokenKey: row.tokenKey ?? '', createdAt: row.createdAt.toISOString(), author: author(row.user), badges: badgesOf(row.badges) };
  if (row.kind === 'pnl' && row.pnl) return { kind: 'pnl', ...base, pnl: row.pnl as unknown as TokenChatPnl };
  return { kind: 'message', ...base, body: row.body };
}

function parseKey(tokenKey: string): { chainIdentifier: string; address: string } {
  if (!isChatTokenKey(tokenKey)) throw new BadRequestException('Unknown coin.');
  if (tokenKey.startsWith('solana:')) return { chainIdentifier: 'solana', address: tokenKey.slice(7) };
  const [ns, chainId, address] = tokenKey.split(':');
  return { chainIdentifier: `${ns}:${chainId}`, address: address! };
}

/**
 * A coin's live chat (2026-10-14) — see @kamby/domain token-chat.ts for the product rules. Messages
 * share PulseMessage (and Pulse's rules) scoped by tokenKey; trades come straight from Kamby's
 * confirmed trades on the coin; reactions are fire-and-forget over Redis, never stored.
 */
@Injectable()
export class TokenChatService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly positions: PositionService,
    private readonly leaderboard: LeaderboardService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('TokenChatService');
  }

  /** The latest messages and the coin's Kamby trades from the last day, oldest first. */
  async list(tokenKey: string): Promise<TokenChatItem[]> {
    const { chainIdentifier, address } = parseKey(tokenKey);
    const since = new Date(Date.now() - TOKEN_CHAT_LIMITS.tradeLookbackHours * 3_600_000);
    const take = TOKEN_CHAT_LIMITS.pageSize;
    const [messages, trades] = await Promise.all([
      prisma.pulseMessage.findMany({
        where: { tokenKey, hiddenAt: null },
        orderBy: { createdAt: 'desc' },
        take,
        include: { user: { select: AUTHOR_SELECT } },
      }),
      this.recentTrades(chainIdentifier, address, since, take),
    ]);
    return [...messages.map(messageItem), ...trades]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, take)
      .reverse();
  }

  async post(userId: string, tokenKey: string, rawBody: string): Promise<TokenChatItem> {
    parseKey(tokenKey);
    const body = normalizePulseBody(rawBody ?? '');
    if (body.length === 0) throw new BadRequestException('Write something first.');
    if (body.length > PULSE_LIMITS.maxLength) throw new BadRequestException(`Keep it under ${PULSE_LIMITS.maxLength} characters.`);
    if (containsLink(body)) throw new BadRequestException("Links aren't allowed in the chat — mention coins with $SYMBOL instead.");
    await this.checkCanPost(userId);
    const last = await prisma.pulseMessage.findFirst({
      where: { userId, tokenKey, createdAt: { gte: new Date(Date.now() - PULSE_LIMITS.duplicateWindowSeconds * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    if (last && last.body.toLowerCase() === body.toLowerCase()) throw new HttpException('You just said that.', HttpStatus.TOO_MANY_REQUESTS);

    const badges = await this.badgesFor(userId, tokenKey);
    const row = await prisma.pulseMessage.create({ data: { userId, tokenKey, body, badges }, include: { user: { select: AUTHOR_SELECT } } });
    const item = messageItem(row);
    await this.publish({ type: 'item', item });
    return item;
  }

  /** Flex your PnL on this coin — worked out here from your real position, never sent by the app. */
  async postPnl(userId: string, tokenKey: string): Promise<TokenChatItem> {
    parseKey(tokenKey);
    const position = (await this.positions.getMine(userId)).find((p) => keyOfPosition(p) === tokenKey);
    if (!position || position.currentValueUsd === null || !(position.costBasisUsd > 0)) {
      throw new BadRequestException("You don't hold this coin right now — buy some to share your PnL.");
    }
    await this.checkCanPost(userId);
    const pnlUsd = position.currentValueUsd - position.costBasisUsd;
    const pnl: TokenChatPnl = {
      symbol: position.symbol,
      logoUrl: position.logoUrl,
      pnlUsd,
      pnlPct: (pnlUsd / position.costBasisUsd) * 100,
      investedUsd: position.costBasisUsd,
      valueUsd: position.currentValueUsd,
    };
    const badges = await this.badgesFor(userId, tokenKey, position.currentValueUsd);
    const row = await prisma.pulseMessage.create({
      data: { userId, tokenKey, kind: 'pnl', body: '', pnl: pnl as unknown as Prisma.InputJsonValue, badges },
      include: { user: { select: AUTHOR_SELECT } },
    });
    const item = messageItem(row);
    await this.publish({ type: 'item', item });
    return item;
  }

  async react(userId: string, tokenKey: string, emoji: string): Promise<void> {
    parseKey(tokenKey);
    if (!isTokenChatReaction(emoji)) throw new BadRequestException('Pick one of the reactions.');
    const ok = await this.redis
      .set(`kamby:chat:react:${userId}`, '1', 'PX', TOKEN_CHAT_LIMITS.reactionCooldownMs, 'NX')
      .catch(() => 'OK');
    if (ok !== 'OK') return; // too fast — dropped quietly, it's only a reaction
    await this.publish({ type: 'reaction', tokenKey, emoji });
  }

  /** One report per user per message; enough of them hide it for everyone. */
  async report(userId: string, messageId: string): Promise<{ hidden: boolean }> {
    const message = await prisma.pulseMessage.findUnique({ where: { id: messageId }, select: { id: true, userId: true, tokenKey: true, hiddenAt: true } });
    if (!message) throw new NotFoundException('Message not found.');
    if (message.userId === userId) throw new BadRequestException("You can't report your own message.");
    if (message.hiddenAt) return { hidden: true };
    try {
      await prisma.pulseReport.create({ data: { messageId, userId } });
    } catch {
      return { hidden: false }; // already reported by this user
    }
    const updated = await prisma.pulseMessage.update({ where: { id: messageId }, data: { reportCount: { increment: 1 } }, select: { reportCount: true } });
    if (updated.reportCount < TOKEN_CHAT_LIMITS.reportsToHide) return { hidden: false };
    await prisma.pulseMessage.update({ where: { id: messageId }, data: { hiddenAt: new Date() } });
    if (message.tokenKey) await this.publish({ type: 'hide', tokenKey: message.tokenKey, id: messageId });
    return { hidden: true };
  }

  private async checkCanPost(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to chat.');
    const cooled = await this.redis.set(`kamby:pulse:cool:${userId}`, '1', 'EX', PULSE_LIMITS.cooldownSeconds, 'NX').catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('Slow down a little — one message every few seconds.', HttpStatus.TOO_MANY_REQUESTS);
  }

  /** 🐳 holds $1K+ of this coin · ⚡ top-10 trader this week · 👑 created this coin (Pump.fun). */
  private async badgesFor(userId: string, tokenKey: string, knownValueUsd?: number): Promise<TokenChatBadge[]> {
    const badges: TokenChatBadge[] = [];
    try {
      const value = knownValueUsd ?? (await this.positions.getMine(userId)).find((p) => keyOfPosition(p) === tokenKey)?.currentValueUsd ?? 0;
      if (value >= TOKEN_CHAT_LIMITS.whaleUsd) badges.push('whale');
      const board = await this.leaderboard.getLeaderboard('7d', TOKEN_CHAT_LIMITS.topTraderRank);
      if (board.entries.some((e) => e.userId === userId && e.realizedPnlUsd > 0)) badges.push('top');
      if (tokenKey.startsWith('solana:')) {
        const coin = await prisma.pumpFunToken.findUnique({ where: { mintAddress: tokenKey.slice(7) }, select: { creatorAddress: true } });
        if (coin?.creatorAddress && (await prisma.wallet.count({ where: { userId, address: coin.creatorAddress } })) > 0) badges.push('dev');
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'token chat: badges unavailable — posting without them');
    }
    return badges;
  }

  private async recentTrades(chainIdentifier: string, address: string, since: Date, take: number): Promise<TokenChatItem[]> {
    const tokenKey = chatTokenKey(chainIdentifier, address)!;
    if (chainIdentifier === 'solana') {
      const rows = await prisma.solanaTradeTransaction.findMany({
        where: { status: 'CONFIRMED', confirmedAt: { gte: since }, OR: [{ inputMint: address }, { outputMint: address }] },
        orderBy: { confirmedAt: 'desc' },
        take,
        include: { user: { select: AUTHOR_SELECT } },
      });
      return rows.map((row) => ({
        kind: 'trade' as const,
        id: row.id,
        tokenKey,
        createdAt: (row.confirmedAt ?? row.submittedAt).toISOString(),
        author: author(row.user),
        side: row.side === 'SELL' ? ('SELL' as const) : ('BUY' as const),
        usd: Number(row.side === 'SELL' ? row.expectedOutputAmount : row.inputAmount) / 1e6,
      }));
    }
    const chainId = Number(chainIdentifier.split(':')[1]);
    const rows = await prisma.tradeTransaction.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: { gte: since },
        chainId,
        tokenMarket: { token: { contractAddress: { equals: address, mode: 'insensitive' } } },
      },
      orderBy: { confirmedAt: 'desc' },
      take,
      include: { ...TRANSACTION_INCLUDE, user: { select: AUTHOR_SELECT } },
    });
    return rows.flatMap((row) => {
      const item = evmTradeItem(toDto(row), tokenKey, author(row.user), row.confirmedAt ?? row.submittedAt);
      return item ? [item] : [];
    });
  }

  private async publish(event: TokenChatEvent): Promise<void> {
    await this.redis.publish(TOKEN_CHAT_REALTIME_CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'token chat realtime publish failed — viewers get it on their next load');
    });
  }
}

function keyOfPosition(p: { tokenAddress: string; chainIdentifier?: string; chain?: 'evm' | 'solana' }): string | null {
  const chainIdentifier = p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : null);
  return chainIdentifier ? chatTokenKey(chainIdentifier, p.tokenAddress) : null;
}

/** An EVM trade as a chat line — its USDC leg is the dollar amount (null if it wasn't USDC). */
export function evmTradeItem(
  dto: ReturnType<typeof toDto>,
  tokenKey: string,
  who: TokenChatItem['author'],
  at: Date,
): TokenChatItem | null {
  if (dto.quoteToken.symbol !== 'USDC' && dto.quoteToken.symbol !== 'USDG') return null;
  const usd = Number(dto.side === 'BUY' ? dto.inputAmountFormatted : dto.expectedOutputAmountFormatted);
  if (!(usd > 0)) return null;
  return { kind: 'trade', id: dto.id, tokenKey, createdAt: at.toISOString(), author: who, side: dto.side, usd };
}

/**
 * Announce a just-confirmed Kamby trade in its coin's chat. Called by the EVM and Solana
 * transaction services right after they mark a trade CONFIRMED; never throws — a missed
 * announcement only means viewers see it on their next load.
 */
export async function announceTradeInChat(
  redis: Redis,
  trade: { id: string; userId: string; chainIdentifier: string; tokenAddress: string; side: 'BUY' | 'SELL'; usd: number },
): Promise<void> {
  try {
    const tokenKey = chatTokenKey(trade.chainIdentifier, trade.tokenAddress);
    if (!tokenKey || !(trade.usd > 0)) return;
    const user = await prisma.user.findUnique({ where: { id: trade.userId }, select: AUTHOR_SELECT });
    if (!user) return;
    const event: TokenChatEvent = {
      type: 'item',
      item: { kind: 'trade', id: trade.id, tokenKey, createdAt: new Date().toISOString(), author: author(user), side: trade.side, usd: trade.usd },
    };
    await redis.publish(TOKEN_CHAT_REALTIME_CHANNEL, JSON.stringify(event));
  } catch {
    // best effort
  }
}
