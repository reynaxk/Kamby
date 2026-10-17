import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma, type DmConversation as DmConversationRow, type DmMessage as DmMessageRow } from '@kamby/db';
import {
  containsLink,
  DM_LIMITS,
  DM_REALTIME_CHANNEL,
  isDmReaction,
  type DmCoin,
  type DmConversation,
  type DmEvent,
  type DmMessage,
  type DmMessageKind,
  type DmPerson,
  type DmPnl,
  type DmUnread,
  type DmUsdc,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { NotificationService } from '../notifications/notification.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PositionService } from '../social/services/position.service';
import { TransferNotifyService } from '../transfers/transfer-notify.service';

const CHAIN_SLUG_TO_IDENTIFIER: Record<string, string> = { solana: 'solana', base: 'eip155:8453', bnb: 'eip155:56', robinhood: 'eip155:4663' };

/** Exported for tests. A pair of users in their stored order (A < B), so one row per pair. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Exported for tests. A message as the app sees it. */
export function toMessage(row: DmMessageRow): DmMessage {
  const data = (row.data ?? null) as Record<string, unknown> | null;
  const kind = row.kind as DmMessageKind;
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    kind,
    body: row.body,
    coin: kind === 'coin' ? (data as unknown as DmCoin) : null,
    pnl: kind === 'pnl' ? (data as unknown as DmPnl) : null,
    usdc: kind === 'usdc' ? (data as unknown as DmUsdc) : null,
    reactions: (row.reactions ?? {}) as Record<string, string[]>,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Exported for tests. Trim, cap runs of blank lines (a wall of newlines is still spam). */
export function normalizeDmBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function preview(m: DmMessageRow): string {
  if (m.kind === 'text') return m.body.slice(0, 120);
  const data = (m.data ?? {}) as { symbol?: string | null; amountUsd?: number };
  if (m.kind === 'coin') return data.symbol ? `$${data.symbol}` : 'a coin';
  if (m.kind === 'pnl') return data.symbol ? `PnL · $${data.symbol}` : 'PnL card';
  return `$${(data.amountUsd ?? 0).toFixed(2)} USDC`;
}

/**
 * Private messages (2026-10-17) — see @kamby/domain dm.ts for the rules. Live delivery rides
 * the private notifications stream (one connection per app), phone pushes ride the notification
 * pipeline as DM_MESSAGE (bucketed: a burst is one buzz), never listed with the notifications.
 */
@Injectable()
export class DmService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notifications: NotificationService,
    private readonly positions: PositionService,
    private readonly transfers: TransferNotifyService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('DmService');
  }

  // --- reading -----------------------------------------------------------------------------

  async list(me: string, box: 'chats' | 'requests'): Promise<DmConversation[]> {
    const rows = await prisma.dmConversation.findMany({
      where: {
        AND: [
          { OR: [{ userAId: me }, { userBId: me }] },
          box === 'requests' ? { status: 'request', requesterId: { not: me } } : { OR: [{ status: 'active' }, { status: 'request', requesterId: me }] },
        ],
        messages: { some: {} },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 60,
    });
    const mine = rows.filter((r) => {
      const hidden = r.userAId === me ? r.aHiddenAt : r.bHiddenAt;
      return !hidden || hidden < r.lastMessageAt;
    });
    return this.summaries(me, mine);
  }

  async unread(me: string): Promise<DmUnread> {
    const rows = await prisma.$queryRaw<{ box: string; n: bigint }[]>`
      SELECT CASE WHEN c.status = 'request' AND c.requester_id <> ${me} THEN 'requests' ELSE 'messages' END AS box,
             COUNT(DISTINCT CASE WHEN c.status = 'request' AND c.requester_id <> ${me} THEN c.id::text ELSE m.id::text END) AS n
      FROM dm_conversations c
      JOIN dm_messages m ON m.conversation_id = c.id
      WHERE (c.user_a_id = ${me} OR c.user_b_id = ${me})
        AND m.sender_id <> ${me}
        AND m.created_at > COALESCE(CASE WHEN c.user_a_id = ${me} THEN c.a_read_at ELSE c.b_read_at END, 'epoch'::timestamp)
        AND ((CASE WHEN c.user_a_id = ${me} THEN c.a_hidden_at ELSE c.b_hidden_at END) IS NULL
          OR (CASE WHEN c.user_a_id = ${me} THEN c.a_hidden_at ELSE c.b_hidden_at END) < c.last_message_at)
      GROUP BY 1`;
    const get = (box: string) => Number(rows.find((r) => r.box === box)?.n ?? 0);
    return { messages: get('messages'), requests: get('requests') };
  }

  async conversation(me: string, id: string): Promise<DmConversation> {
    const row = await this.member(me, id);
    const [summary] = await this.summaries(me, [row]);
    return summary!;
  }

  async messages(me: string, id: string, before?: string): Promise<{ items: DmMessage[]; nextBefore: string | null }> {
    await this.member(me, id);
    const take = DM_LIMITS.pageSize;
    const beforeDate = before ? new Date(before) : null;
    const rows = await prisma.dmMessage.findMany({
      where: { conversationId: id, ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    const page = rows.slice(0, take);
    return { items: page.map(toMessage), nextBefore: rows.length > take ? page[page.length - 1]!.createdAt.toISOString() : null };
  }

  // --- starting a chat ---------------------------------------------------------------------

  /** The chat with @username — created (empty) if there isn't one yet. */
  async open(me: string, rawUsername: string): Promise<DmConversation> {
    const username = rawUsername.replace(/^@/, '').trim().toLowerCase();
    const other = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!other) throw new NotFoundException('No Kamby user with that name.');
    if (other.id === me) throw new BadRequestException("That's you.");
    const meRow = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!meRow?.username) throw new ForbiddenException('Set a username in your profile to send messages.');
    if (await this.blockedEitherWay(me, other.id)) throw new ForbiddenException("You can't message this user.");

    const [userAId, userBId] = orderedPair(me, other.id);
    let row = await prisma.dmConversation.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
    if (!row) {
      const mutual = await this.followEachOther(me, other.id);
      try {
        row = await prisma.dmConversation.create({ data: { userAId, userBId, requesterId: me, status: mutual ? 'active' : 'request' } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        row = await prisma.dmConversation.findUniqueOrThrow({ where: { userAId_userBId: { userAId, userBId } } });
      }
    }
    const [summary] = await this.summaries(me, [row]);
    return summary!;
  }

  // --- writing -----------------------------------------------------------------------------

  async sendText(me: string, id: string, rawBody: string): Promise<DmMessage> {
    const body = normalizeDmBody(rawBody ?? '');
    if (body.length === 0) throw new BadRequestException('Write something first.');
    if (body.length > DM_LIMITS.maxLength) throw new BadRequestException(`Keep it under ${DM_LIMITS.maxLength} characters.`);
    if (containsLink(body)) throw new BadRequestException("Links aren't allowed in messages — share a coin with the + button instead.");
    return this.write(me, id, { kind: 'text', body, data: null });
  }

  async sendCoin(me: string, id: string, chain: string, tokenAddress: string): Promise<DmMessage> {
    const coin = await this.resolveCoin(chain, tokenAddress);
    if (!coin) throw new BadRequestException("Kamby doesn't know this coin yet.");
    return this.write(me, id, { kind: 'coin', body: '', data: coin });
  }

  /** A PnL card from the sender's real position — the numbers can't be typed in. */
  async sendPnl(me: string, id: string, chain: string, tokenAddress: string): Promise<DmMessage> {
    const chainIdentifier = CHAIN_SLUG_TO_IDENTIFIER[chain] ?? chain;
    const position = (await this.positions.getMine(me)).find(
      (p) => (p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : null)) === chainIdentifier && p.tokenAddress.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (!position || position.currentValueUsd === null || !(position.costBasisUsd > 0)) {
      throw new BadRequestException("You don't hold this coin right now — buy some to share your PnL.");
    }
    const pnlUsd = position.currentValueUsd - position.costBasisUsd;
    const pnl: DmPnl = {
      chainIdentifier,
      tokenAddress: position.tokenAddress,
      symbol: position.symbol,
      logoUrl: position.logoUrl,
      pnlUsd,
      pnlPct: (pnlUsd / position.costBasisUsd) * 100,
      investedUsd: position.costBasisUsd,
      valueUsd: position.currentValueUsd,
    };
    return this.write(me, id, { kind: 'pnl', body: '', data: pnl });
  }

  /** "Sent $5 USDC" — only once the transfer is found on-chain (TransferNotifyService checks
   *  it moved USDC from the sender's wallet to the recipient's, and notifies them). */
  async sendUsdc(me: string, id: string, chain: string, txRef: string): Promise<DmMessage> {
    const row = await this.member(me, id);
    const otherId = row.userAId === me ? row.userBId : row.userAId;
    const other = await prisma.user.findUnique({ where: { id: otherId }, select: { username: true } });
    if (!other?.username) throw new BadRequestException("This user can't receive USDC by name.");
    const existing = await prisma.dmMessage.findUnique({ where: { txRef } });
    if (existing) return toMessage(existing);
    const { amountUsd } = await this.transfers.notify(me, { username: other.username, chain, txRef });
    const usdc: DmUsdc = { amountUsd, chainIdentifier: CHAIN_SLUG_TO_IDENTIFIER[chain] ?? chain, txRef };
    return this.write(me, id, { kind: 'usdc', body: '', data: usdc, txRef }, { skipPush: true });
  }

  async read(me: string, id: string): Promise<void> {
    const row = await this.member(me, id);
    const at = new Date();
    await prisma.dmConversation.update({ where: { id }, data: row.userAId === me ? { aReadAt: at } : { bReadAt: at } });
    await this.publish({ type: 'read', userIds: [row.userAId, row.userBId], conversationId: id, userId: me, atIso: at.toISOString() });
  }

  async typing(me: string, id: string): Promise<void> {
    const row = await this.member(me, id);
    const ok = await this.redis.set(`kamby:dm:typing:${me}:${id}`, '1', 'PX', 2000, 'NX').catch(() => 'OK');
    if (ok !== 'OK') return;
    const other = row.userAId === me ? row.userBId : row.userAId;
    await this.publish({ type: 'typing', userIds: [other], conversationId: id, userId: me });
  }

  async react(me: string, messageId: string, emoji: string): Promise<Record<string, string[]>> {
    if (!isDmReaction(emoji)) throw new BadRequestException('Pick one of the reactions.');
    const message = await prisma.dmMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found.');
    const row = await this.member(me, message.conversationId);
    const reactions = { ...((message.reactions ?? {}) as Record<string, string[]>) };
    const who = new Set(reactions[emoji] ?? []);
    if (who.has(me)) who.delete(me);
    else who.add(me);
    if (who.size > 0) reactions[emoji] = [...who];
    else delete reactions[emoji];
    await prisma.dmMessage.update({ where: { id: messageId }, data: { reactions } });
    await this.publish({ type: 'reaction', userIds: [row.userAId, row.userBId], conversationId: row.id, messageId, reactions });
    return reactions;
  }

  // --- requests, blocking, reporting -------------------------------------------------------

  async accept(me: string, id: string): Promise<DmConversation> {
    const row = await this.member(me, id);
    if (row.status === 'request' && row.requesterId !== me) {
      await prisma.dmConversation.update({ where: { id }, data: { status: 'active' } });
      await this.publish({ type: 'state', userIds: [row.userAId, row.userBId], conversationId: id });
    }
    return this.conversation(me, id);
  }

  /** Hide the chat from my list (a declined request, a deleted chat) until a newer message. */
  async hide(me: string, id: string): Promise<void> {
    const row = await this.member(me, id);
    const at = new Date();
    await prisma.dmConversation.update({ where: { id }, data: row.userAId === me ? { aHiddenAt: at, aReadAt: at } : { bHiddenAt: at, bReadAt: at } });
    await this.publish({ type: 'state', userIds: [me], conversationId: id });
  }

  async block(me: string, id: string, blocked: boolean): Promise<DmConversation> {
    const row = await this.member(me, id);
    const other = row.userAId === me ? row.userBId : row.userAId;
    if (blocked) {
      await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: me, blockedId: other } }, update: {}, create: { blockerId: me, blockedId: other } });
    } else {
      await prisma.userBlock.deleteMany({ where: { blockerId: me, blockedId: other } });
    }
    await this.publish({ type: 'state', userIds: [row.userAId, row.userBId], conversationId: id });
    return this.conversation(me, id);
  }

  /** Kept for review; reporting also blocks them, so it stops right away. */
  async report(me: string, id: string, reason?: string): Promise<void> {
    await this.member(me, id);
    await prisma.dmReport.create({ data: { conversationId: id, reporterId: me, reason: reason?.slice(0, 200) ?? null } }).catch((error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    });
    await this.block(me, id, true);
    this.logger.warn({ conversationId: id, reporterId: me }, 'Private chat reported');
  }

  // --- internals ---------------------------------------------------------------------------

  private async write(
    me: string,
    id: string,
    message: { kind: DmMessageKind; body: string; data: unknown; txRef?: string },
    opts: { skipPush?: boolean } = {},
  ): Promise<DmMessage> {
    const row = await this.member(me, id);
    const other = row.userAId === me ? row.userBId : row.userAId;
    if (await this.blockedEitherWay(me, other)) throw new ForbiddenException("You can't message this user.");

    const cooled = await this.redis.set(`kamby:dm:cool:${me}`, '1', 'PX', DM_LIMITS.cooldownMs, 'NX').catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);

    let status = row.status;
    if (status === 'request') {
      if (row.requesterId === me) {
        const sent = await prisma.dmMessage.count({ where: { conversationId: id, senderId: me } });
        if (sent >= DM_LIMITS.requestMessagesMax) throw new ForbiddenException('Wait for them to accept your message request.');
        if (sent === 0) {
          const startedToday = await prisma.dmConversation.count({
            where: { requesterId: me, createdAt: { gte: new Date(Date.now() - 86_400_000) }, messages: { some: {} } },
          });
          if (startedToday >= DM_LIMITS.newPerDay) throw new HttpException("You've started a lot of new chats today — try again tomorrow.", HttpStatus.TOO_MANY_REQUESTS);
        }
      } else {
        status = 'active'; // replying accepts the request
      }
    }

    const at = new Date();
    const [created] = await prisma.$transaction([
      prisma.dmMessage.create({
        data: {
          conversationId: id,
          senderId: me,
          kind: message.kind,
          body: message.body,
          data: message.data === null ? Prisma.JsonNull : (message.data as Prisma.InputJsonValue),
          txRef: message.txRef ?? null,
        },
      }),
      prisma.dmConversation.update({
        where: { id },
        data: { lastMessageAt: at, status, ...(row.userAId === me ? { aReadAt: at } : { bReadAt: at }) },
      }),
    ]);
    const dto = toMessage(created);
    await this.publish({ type: 'message', userIds: [row.userAId, row.userBId], conversationId: id, message: dto });
    if (status !== row.status) await this.publish({ type: 'state', userIds: [row.userAId, row.userBId], conversationId: id });
    if (!opts.skipPush) {
      const bucket = Math.floor(at.getTime() / (DM_LIMITS.pushBucketMinutes * 60_000));
      await this.notifications
        .create({ userId: other, type: 'DM_MESSAGE', dedupeKey: `dm:${id}:${other}:${bucket}`, actorUserId: me })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'DM push notification failed'));
    }
    return dto;
  }

  private async member(me: string, id: string): Promise<DmConversationRow> {
    const row = await prisma.dmConversation.findUnique({ where: { id } });
    if (!row || (row.userAId !== me && row.userBId !== me)) throw new NotFoundException('Chat not found.');
    return row;
  }

  private async blockedEitherWay(a: string, b: string): Promise<boolean> {
    const n = await prisma.userBlock.count({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } });
    return n > 0;
  }

  private async followEachOther(a: string, b: string): Promise<boolean> {
    const [ab, ba] = await Promise.all([
      prisma.follow.count({ where: { userId: a, wallet: { userId: b } } }),
      prisma.follow.count({ where: { userId: b, wallet: { userId: a } } }),
    ]);
    return ab > 0 && ba > 0;
  }

  private async resolveCoin(chain: string, tokenAddress: string): Promise<DmCoin | null> {
    const chainIdentifier = CHAIN_SLUG_TO_IDENTIFIER[chain] ?? chain;
    if (chainIdentifier === 'solana') {
      const [market, pump] = await Promise.all([
        prisma.solanaTokenMarket.findUnique({ where: { mintAddress: tokenAddress }, select: { symbol: true, name: true, logoUrl: true } }),
        prisma.pumpFunToken.findUnique({ where: { mintAddress: tokenAddress }, select: { symbol: true, name: true } }),
      ]);
      const found = market ?? (pump ? { ...pump, logoUrl: null } : null);
      return found ? { chainIdentifier, tokenAddress, symbol: found.symbol, name: found.name, logoUrl: found.logoUrl } : null;
    }
    const token = await prisma.token.findFirst({
      where: { contractAddress: { equals: tokenAddress, mode: 'insensitive' }, chain: { identifier: chainIdentifier } },
      select: { contractAddress: true, symbol: true, name: true, logoUrl: true },
    });
    return token ? { chainIdentifier, tokenAddress: token.contractAddress, symbol: token.symbol, name: token.name, logoUrl: token.logoUrl } : null;
  }

  private async summaries(me: string, rows: DmConversationRow[]): Promise<DmConversation[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const otherIds = [...new Set(rows.map((r) => (r.userAId === me ? r.userBId : r.userAId)))];
    const [lasts, unreadRows, people, blocks] = await Promise.all([
      prisma.dmMessage.findMany({ where: { conversationId: { in: ids } }, orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }], distinct: ['conversationId'] }),
      prisma.$queryRaw<{ id: string; n: bigint }[]>`
        SELECT c.id, COUNT(m.id) AS n
        FROM dm_conversations c
        JOIN dm_messages m ON m.conversation_id = c.id
        WHERE c.id IN (${Prisma.join(ids)})
          AND m.sender_id <> ${me}
          AND m.created_at > COALESCE(CASE WHEN c.user_a_id = ${me} THEN c.a_read_at ELSE c.b_read_at END, 'epoch'::timestamp)
        GROUP BY c.id`,
      prisma.user.findMany({
        where: { id: { in: otherIds } },
        select: { id: true, username: true, avatarUrl: true, wallets: { where: { verifiedAt: { not: null } }, select: { address: true }, orderBy: { verifiedAt: 'asc' }, take: 1 } },
      }),
      prisma.userBlock.findMany({ where: { blockerId: me, blockedId: { in: otherIds } }, select: { blockedId: true } }),
    ]);
    const lastBy = new Map(lasts.map((m) => [m.conversationId, m]));
    const unreadBy = new Map(unreadRows.map((u) => [u.id, Number(u.n)]));
    const personBy = new Map<string, DmPerson>(
      people.map((p) => [p.id, { userId: p.id, username: p.username, avatarUrl: p.avatarUrl, walletAddress: p.wallets[0]?.address ?? null }]),
    );
    const blocked = new Set(blocks.map((b) => b.blockedId));
    return rows.map((r) => {
      const otherId = r.userAId === me ? r.userBId : r.userAId;
      const last = lastBy.get(r.id);
      const otherReadAt = r.userAId === me ? r.bReadAt : r.aReadAt;
      return {
        id: r.id,
        state: r.status === 'active' ? 'active' : r.requesterId === me ? 'pending' : 'request',
        other: personBy.get(otherId) ?? { userId: otherId, username: null, avatarUrl: null, walletAddress: null },
        lastMessage: last ? { body: preview(last), kind: last.kind as DmMessageKind, senderId: last.senderId, createdAt: last.createdAt.toISOString() } : null,
        unread: unreadBy.get(r.id) ?? 0,
        otherReadAt: otherReadAt ? otherReadAt.toISOString() : null,
        blocked: blocked.has(otherId),
      };
    });
  }

  private async publish(event: DmEvent): Promise<void> {
    await this.redis.publish(DM_REALTIME_CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'DM realtime publish failed — the other side gets it on their next load');
    });
  }
}
