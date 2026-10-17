import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma, type DmConversation as DmConversationRow, type DmMessage as DmMessageRow } from '@kamby/db';
import {
  containsLink,
  DM_LIMITS,
  DM_REALTIME_CHANNEL,
  isDmReaction,
  type DmCoin,
  type DmChannelInfo,
  type DmConversation,
  type DmInvitePreview,
  type DmReplyRef,
  dmMentions,
  DM_PRESENCE,
  type DmEvent,
  type DmMessage,
  type DmMessageKind,
  type DmPerson,
  type DmPnl,
  type DmSystem,
  type DmUnread,
  type DmUsdc,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { randomInt } from 'node:crypto';
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
    system: kind === 'system' ? (data as unknown as DmSystem) : null,
    channelId: row.channelId ?? null,
    replyTo: kind === 'text' && data && typeof data === 'object' && 'replyTo' in data ? (data.replyTo as DmReplyRef) : null,
    reactions: (row.reactions ?? {}) as Record<string, string[]>,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Exported for tests. Trim, cap runs of blank lines (a wall of newlines is still spam). */
export function normalizeDmBody(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Exported for tests. A group event as one line of text (for chat-list previews). */
export function systemText(s: DmSystem): string {
  const who = (names: string[]) => names.map((n) => `@${n}`).join(', ');
  const actor = s.actor ? `@${s.actor}` : 'Someone';
  switch (s.event) {
    case 'created':
      return `${actor} created the group`;
    case 'createdCommunity':
      return `${actor} created the community`;
    case 'joined':
      return `${actor} joined`;
    case 'added':
      return `${actor} added ${who(s.targets)}`;
    case 'removed':
      return `${actor} removed ${who(s.targets)}`;
    case 'left':
      return `${actor} left`;
    case 'renamed':
      return `${actor} renamed the group to “${s.title ?? ''}”`;
    case 'call': {
      const kind = s.video ? 'Video call' : 'Call';
      if (!s.durationSec) return `Missed ${kind.toLowerCase()}`;
      const m = Math.floor(s.durationSec / 60);
      return `${kind} · ${m > 0 ? `${m} min` : `${s.durationSec}s`}`;
    }
  }
}

/** An invite code: 8 characters people can read out (no 0/O/1/l). */
function inviteCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

function preview(m: DmMessageRow): string {
  if (m.kind === 'text') return m.body.slice(0, 120);
  const data = (m.data ?? {}) as { symbol?: string | null; amountUsd?: number };
  if (m.kind === 'coin') return data.symbol ? `$${data.symbol}` : 'a coin';
  if (m.kind === 'pnl') return data.symbol ? `PnL · $${data.symbol}` : 'PnL card';
  if (m.kind === 'system') return systemText(m.data as unknown as DmSystem);
  return `$${(data.amountUsd ?? 0).toFixed(2)} USDC`;
}

/** Who a chat belongs to, worked out once per request. */
interface Access {
  row: DmConversationRow;
  isGroup: boolean;
  /** For a group: my membership. */
  myRole: 'owner' | 'member' | null;
  myStatus: 'active' | 'invited';
  /** Everyone who should get live events: both people (1:1) or the active members (group). */
  participants: string[];
  /** The other person, 1:1 only. */
  otherId: string | null;
}

/**
 * Private messages (2026-10-17) — see @kamby/domain dm.ts for the rules. 1:1 chats keep their
 * pair on the conversation row; group chats (up to 32 people) keep theirs in dm_members, with
 * an owner who adds/removes people, and invites from someone you don't follow waiting in
 * Requests. Live delivery rides the private notifications stream; phone pushes ride the
 * notification pipeline as DM_MESSAGE (one per chat per few minutes), never listed with the
 * notifications.
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
    const [pairs, groups] = await Promise.all([
      prisma.dmConversation.findMany({
        where: {
          isGroup: false,
          AND: [
            { OR: [{ userAId: me }, { userBId: me }] },
            box === 'requests' ? { status: 'request', requesterId: { not: me } } : { OR: [{ status: 'active' }, { status: 'request', requesterId: me }] },
          ],
          messages: { some: {} },
        },
        orderBy: { lastMessageAt: 'desc' },
        take: 60,
      }),
      prisma.dmConversation.findMany({
        where: { isGroup: true, members: { some: { userId: me, status: box === 'requests' ? 'invited' : 'active' } } },
        include: { members: { where: { userId: me }, select: { hiddenAt: true } } },
        orderBy: { lastMessageAt: 'desc' },
        take: 60,
      }),
    ]);
    const visiblePairs = pairs.filter((r) => {
      const hidden = r.userAId === me ? r.aHiddenAt : r.bHiddenAt;
      return !hidden || hidden < r.lastMessageAt;
    });
    const visibleGroups = groups.filter((g) => {
      const hidden = g.members[0]?.hiddenAt;
      return !hidden || hidden < g.lastMessageAt;
    });
    const rows: DmConversationRow[] = [...visiblePairs, ...visibleGroups.map(({ members: _members, ...g }) => g)];
    rows.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());
    return this.summaries(me, rows.slice(0, 60));
  }

  async unread(me: string): Promise<DmUnread> {
    const [pairRows, groupRows] = await Promise.all([
      prisma.$queryRaw<{ box: string; n: bigint }[]>`
        SELECT CASE WHEN c.status = 'request' AND c.requester_id <> ${me} THEN 'requests' ELSE 'messages' END AS box,
               COUNT(DISTINCT CASE WHEN c.status = 'request' AND c.requester_id <> ${me} THEN c.id::text ELSE m.id::text END) AS n
        FROM dm_conversations c
        JOIN dm_messages m ON m.conversation_id = c.id
        WHERE c.is_group = false
          AND (c.user_a_id = ${me} OR c.user_b_id = ${me})
          AND m.sender_id <> ${me}
          AND m.created_at > COALESCE(CASE WHEN c.user_a_id = ${me} THEN c.a_read_at ELSE c.b_read_at END, 'epoch'::timestamp)
          AND ((CASE WHEN c.user_a_id = ${me} THEN c.a_hidden_at ELSE c.b_hidden_at END) IS NULL
            OR (CASE WHEN c.user_a_id = ${me} THEN c.a_hidden_at ELSE c.b_hidden_at END) < c.last_message_at)
        GROUP BY 1`,
      prisma.$queryRaw<{ box: string; n: bigint }[]>`
        SELECT CASE WHEN dm.status = 'invited' THEN 'requests' ELSE 'messages' END AS box,
               COUNT(DISTINCT CASE WHEN dm.status = 'invited' THEN c.id::text ELSE m.id::text END) AS n
        FROM dm_members dm
        JOIN dm_conversations c ON c.id = dm.conversation_id
        JOIN dm_messages m ON m.conversation_id = c.id
        WHERE dm.user_id = ${me}
          AND m.sender_id <> ${me}
          AND m.kind <> 'system'
          AND m.created_at > COALESCE(dm.read_at, 'epoch'::timestamp)
          AND (dm.hidden_at IS NULL OR dm.hidden_at < c.last_message_at)
        GROUP BY 1`,
    ]);
    const get = (box: string) => [...pairRows, ...groupRows].filter((r) => r.box === box).reduce((n, r) => n + Number(r.n), 0);
    return { messages: get('messages'), requests: get('requests') };
  }

  async conversation(me: string, id: string): Promise<DmConversation> {
    const { row } = await this.access(me, id);
    const [summary] = await this.summaries(me, [row]);
    return summary!;
  }

  async messages(me: string, id: string, before?: string, channelId?: string): Promise<{ items: DmMessage[]; nextBefore: string | null }> {
    const a = await this.access(me, id);
    const take = DM_LIMITS.pageSize;
    const beforeDate = before ? new Date(before) : null;
    // A community shows one channel at a time (its event lines everywhere).
    const channel = a.row.isCommunity ? await this.channelOf(id, channelId) : null;
    const rows = await prisma.dmMessage.findMany({
      where: {
        conversationId: id,
        ...(channel ? { OR: [{ channelId: channel.id }, { kind: 'system' }] } : {}),
        ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
    });
    const page = rows.slice(0, take);
    return { items: page.map(toMessage), nextBefore: rows.length > take ? page[page.length - 1]!.createdAt.toISOString() : null };
  }

  // --- starting a chat ---------------------------------------------------------------------

  /** The 1:1 chat with @username — created (empty) if there isn't one yet. */
  async open(me: string, rawUsername: string): Promise<DmConversation> {
    const username = rawUsername.replace(/^@/, '').trim().toLowerCase();
    const other = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!other) throw new NotFoundException('No Kamby user with that name.');
    if (other.id === me) throw new BadRequestException("That's you.");
    await this.requireUsername(me);
    if (await this.blockedEitherWay(me, other.id)) throw new ForbiddenException("You can't message this user.");

    const [userAId, userBId] = orderedPair(me, other.id);
    let row = await prisma.dmConversation.findFirst({ where: { userAId, userBId, isGroup: false } });
    if (!row) {
      const mutual = await this.followEachOther(me, other.id);
      try {
        row = await prisma.dmConversation.create({ data: { userAId, userBId, requesterId: me, status: mutual ? 'active' : 'request' } });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        row = await prisma.dmConversation.findFirstOrThrow({ where: { userAId, userBId, isGroup: false } });
      }
    }
    const [summary] = await this.summaries(me, [row]);
    return summary!;
  }

  /** A new group with you as its owner. People who follow you join right away; anyone else
   *  gets it as a request (nobody can be dropped into a group by a stranger). */
  async createGroup(me: string, rawTitle: string, usernames: string[]): Promise<DmConversation> {
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    if (title.length === 0 || title.length > DM_LIMITS.groupTitleMax) throw new BadRequestException(`Give the group a name (up to ${DM_LIMITS.groupTitleMax} characters).`);
    if (containsLink(title)) throw new BadRequestException("Links aren't allowed in a group name.");
    const myName = await this.requireUsername(me);
    const invitees = await this.resolveInvitees(me, usernames);
    if (invitees.length === 0) throw new BadRequestException('Add at least one person.');
    if (invitees.length + 1 > DM_LIMITS.groupMaxMembers) throw new BadRequestException(`A group can have up to ${DM_LIMITS.groupMaxMembers} people.`);
    const startedToday = await prisma.dmConversation.count({ where: { requesterId: me, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (startedToday >= DM_LIMITS.newPerDay) throw new HttpException("You've started a lot of new chats today — try again tomorrow.", HttpStatus.TOO_MANY_REQUESTS);

    const followers = await this.followersOf(me, invitees.map((u) => u.id));
    const row = await prisma.dmConversation.create({
      data: {
        isGroup: true,
        title,
        ownerId: me,
        requesterId: me,
        status: 'active',
        members: {
          create: [
            { userId: me, role: 'owner', status: 'active', readAt: new Date() },
            ...invitees.map((u) => ({ userId: u.id, role: 'member', status: followers.has(u.id) ? 'active' : 'invited' })),
          ],
        },
      },
    });
    await this.system(row.id, { event: 'created', actor: myName, targets: invitees.map((u) => u.username) });
    await this.notifyChat(invitees.map((u) => u.id), me, row, { dmKind: 'added' }, () => `added:${row.id}`);
    const [summary] = await this.summaries(me, [row]);
    return summary!;
  }

  async addMembers(me: string, id: string, usernames: string[]): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    const myName = await this.requireUsername(me);
    const existing = await prisma.dmMember.findMany({ where: { conversationId: id }, select: { userId: true } });
    const invitees = (await this.resolveInvitees(me, usernames)).filter((u) => !existing.some((e) => e.userId === u.id));
    if (invitees.length === 0) throw new BadRequestException("They're already in the group.");
    const max = a.row.isCommunity ? DM_LIMITS.communityMaxMembers : DM_LIMITS.groupMaxMembers;
    if (existing.length + invitees.length > max) throw new BadRequestException(`A group can have up to ${max} people.`);
    const followers = await this.followersOf(me, invitees.map((u) => u.id));
    await prisma.dmMember.createMany({
      data: invitees.map((u) => ({ conversationId: id, userId: u.id, role: 'member', status: followers.has(u.id) ? 'active' : 'invited' })),
      skipDuplicates: true,
    });
    await this.system(id, { event: 'added', actor: myName, targets: invitees.map((u) => u.username) });
    await this.notifyChat(invitees.map((u) => u.id), me, a.row, { dmKind: 'added' }, () => `added:${id}`);
    return this.conversation(me, id);
  }

  async removeMember(me: string, id: string, userId: string): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    if (userId === me) throw new BadRequestException('Use Leave to leave the group.');
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    const removed = await prisma.dmMember.deleteMany({ where: { conversationId: id, userId } });
    if (removed.count === 0) throw new NotFoundException("They're not in the group.");
    await this.system(id, { event: 'removed', actor: await this.requireUsername(me), targets: target?.username ? [target.username] : [] }, [...a.participants]);
    return this.conversation(me, id);
  }

  async leave(me: string, id: string): Promise<void> {
    const a = await this.access(me, id);
    if (!a.isGroup) throw new BadRequestException('Only groups can be left — delete the chat instead.');
    const myName = await this.requireUsername(me);
    await prisma.dmMember.delete({ where: { conversationId_userId: { conversationId: id, userId: me } } });
    if (a.myRole === 'owner') {
      // The longest-standing active member takes over.
      const next = await prisma.dmMember.findFirst({ where: { conversationId: id, status: 'active' }, orderBy: { joinedAt: 'asc' } });
      await prisma.dmConversation.update({ where: { id }, data: { ownerId: next?.userId ?? null } });
      if (next) await prisma.dmMember.update({ where: { conversationId_userId: { conversationId: id, userId: next.userId } }, data: { role: 'owner' } });
    }
    if (a.myStatus === 'active') await this.system(id, { event: 'left', actor: myName, targets: [] }, a.participants);
    else await this.publish({ type: 'state', userIds: [me], conversationId: id });
  }

  async rename(me: string, id: string, rawTitle: string): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    if (title.length === 0 || title.length > DM_LIMITS.groupTitleMax) throw new BadRequestException(`Give the group a name (up to ${DM_LIMITS.groupTitleMax} characters).`);
    if (containsLink(title)) throw new BadRequestException("Links aren't allowed in a group name.");
    await prisma.dmConversation.update({ where: { id }, data: { title } });
    await this.system(id, { event: 'renamed', actor: await this.requireUsername(me), targets: [], title });
    return this.conversation(me, id);
  }

  // --- writing -----------------------------------------------------------------------------

  async sendText(me: string, id: string, rawBody: string, channelId?: string, replyToId?: string): Promise<DmMessage> {
    const body = normalizeDmBody(rawBody ?? '');
    if (body.length === 0) throw new BadRequestException('Write something first.');
    if (body.length > DM_LIMITS.maxLength) throw new BadRequestException(`Keep it under ${DM_LIMITS.maxLength} characters.`);
    if (containsLink(body)) throw new BadRequestException("Links aren't allowed in messages — share a coin with the + button instead.");
    // A reply keeps a small quote of the line it answers (so it still reads right if that line
    // scrolls far away) — only lines from this same chat.
    let replyTo: DmReplyRef | null = null;
    if (replyToId) {
      const original = await prisma.dmMessage.findFirst({ where: { id: replyToId, conversationId: id, kind: { not: 'system' } } });
      if (original) {
        const sender = await prisma.user.findUnique({ where: { id: original.senderId }, select: { username: true } });
        replyTo = { id: original.id, senderId: original.senderId, username: sender?.username ?? null, preview: preview(original).slice(0, 90) };
      }
    }
    return this.write(me, id, { kind: 'text', body, data: replyTo ? { replyTo } : null, channelId });
  }

  async sendCoin(me: string, id: string, chain: string, tokenAddress: string, channelId?: string): Promise<DmMessage> {
    const coin = await this.resolveCoin(chain, tokenAddress);
    if (!coin) throw new BadRequestException("Kamby doesn't know this coin yet.");
    return this.write(me, id, { kind: 'coin', body: '', data: coin, channelId });
  }

  /** A PnL card from the sender's real position — the numbers can't be typed in. */
  async sendPnl(me: string, id: string, chain: string, tokenAddress: string, channelId?: string): Promise<DmMessage> {
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
    return this.write(me, id, { kind: 'pnl', body: '', data: pnl, channelId });
  }

  /** "Sent $5 USDC" — 1:1 only, and only once the transfer is found on-chain (TransferNotifyService
   *  checks it moved USDC from the sender's wallet to the recipient's, and notifies them). */
  async sendUsdc(me: string, id: string, chain: string, txRef: string): Promise<DmMessage> {
    const a = await this.access(me, id);
    if (a.isGroup || !a.otherId) throw new BadRequestException('Send USDC from a one-to-one chat.');
    const other = await prisma.user.findUnique({ where: { id: a.otherId }, select: { username: true } });
    if (!other?.username) throw new BadRequestException("This user can't receive USDC by name.");
    const existing = await prisma.dmMessage.findUnique({ where: { txRef } });
    if (existing) return toMessage(existing);
    const { amountUsd } = await this.transfers.notify(me, { username: other.username, chain, txRef });
    const usdc: DmUsdc = { amountUsd, chainIdentifier: CHAIN_SLUG_TO_IDENTIFIER[chain] ?? chain, txRef };
    return this.write(me, id, { kind: 'usdc', body: '', data: usdc, txRef }, { skipPush: true });
  }

  async read(me: string, id: string): Promise<void> {
    const a = await this.access(me, id);
    const at = new Date();
    if (a.isGroup) {
      await prisma.dmMember.update({ where: { conversationId_userId: { conversationId: id, userId: me } }, data: { readAt: at } });
    } else {
      await prisma.dmConversation.update({ where: { id }, data: a.row.userAId === me ? { aReadAt: at } : { bReadAt: at } });
    }
    await this.publish({ type: 'read', userIds: a.participants, conversationId: id, userId: me, atIso: at.toISOString() });
  }

  async typing(me: string, id: string): Promise<void> {
    const a = await this.access(me, id);
    const ok = await this.redis.set(`kamby:dm:typing:${me}:${id}`, '1', 'PX', 2000, 'NX').catch(() => 'OK');
    if (ok !== 'OK') return;
    await this.publish({ type: 'typing', userIds: a.participants.filter((u) => u !== me), conversationId: id, userId: me });
  }

  async react(me: string, messageId: string, emoji: string): Promise<Record<string, string[]>> {
    if (!isDmReaction(emoji)) throw new BadRequestException('Pick one of the reactions.');
    const message = await prisma.dmMessage.findUnique({ where: { id: messageId } });
    if (!message) throw new NotFoundException('Message not found.');
    const a = await this.access(me, message.conversationId);
    const reactions = { ...((message.reactions ?? {}) as Record<string, string[]>) };
    const who = new Set(reactions[emoji] ?? []);
    if (who.has(me)) who.delete(me);
    else who.add(me);
    if (who.size > 0) reactions[emoji] = [...who];
    else delete reactions[emoji];
    await prisma.dmMessage.update({ where: { id: messageId }, data: { reactions } });
    await this.publish({ type: 'reaction', userIds: a.participants, conversationId: a.row.id, messageId, reactions });
    if (who.has(me) && message.senderId !== me && a.participants.includes(message.senderId)) {
      await this.notifyChat([message.senderId], me, a.row, { dmKind: 'reaction', preview: preview(message), emoji }, () => `react:${messageId}:${me}:${emoji}`);
    }
    return reactions;
  }

  // --- requests, blocking, reporting -------------------------------------------------------

  async accept(me: string, id: string): Promise<DmConversation> {
    const a = await this.access(me, id);
    if (a.isGroup && a.myStatus === 'invited') {
      await prisma.dmMember.update({ where: { conversationId_userId: { conversationId: id, userId: me } }, data: { status: 'active', readAt: new Date() } });
      await this.publish({ type: 'state', userIds: [...a.participants, me], conversationId: id });
    } else if (!a.isGroup && a.row.status === 'request' && a.row.requesterId !== me) {
      await prisma.dmConversation.update({ where: { id }, data: { status: 'active' } });
      await this.publish({ type: 'state', userIds: a.participants, conversationId: id });
      if (a.row.requesterId) await this.notifyChat([a.row.requesterId], me, a.row, { dmKind: 'accepted' }, () => `accepted:${id}`);
    }
    return this.conversation(me, id);
  }

  /** Hide the chat from my list (a declined request, a deleted chat) until a newer message.
   *  Declining a group invite leaves the group. */
  async hide(me: string, id: string): Promise<void> {
    const a = await this.access(me, id);
    const at = new Date();
    if (a.isGroup) {
      if (a.myStatus === 'invited') return this.leave(me, id);
      await prisma.dmMember.update({ where: { conversationId_userId: { conversationId: id, userId: me } }, data: { hiddenAt: at, readAt: at } });
    } else {
      await prisma.dmConversation.update({ where: { id }, data: a.row.userAId === me ? { aHiddenAt: at, aReadAt: at } : { bHiddenAt: at, bReadAt: at } });
    }
    await this.publish({ type: 'state', userIds: [me], conversationId: id });
  }

  async block(me: string, id: string, blocked: boolean): Promise<DmConversation> {
    const a = await this.access(me, id);
    if (a.isGroup || !a.otherId) throw new BadRequestException('Leave the group instead.');
    if (blocked) {
      await prisma.userBlock.upsert({ where: { blockerId_blockedId: { blockerId: me, blockedId: a.otherId } }, update: {}, create: { blockerId: me, blockedId: a.otherId } });
    } else {
      await prisma.userBlock.deleteMany({ where: { blockerId: me, blockedId: a.otherId } });
    }
    await this.publish({ type: 'state', userIds: a.participants, conversationId: id });
    return this.conversation(me, id);
  }

  /** Kept for review; reporting a 1:1 chat also blocks them, a group report also leaves it. */
  async report(me: string, id: string, reason?: string): Promise<void> {
    const a = await this.access(me, id);
    await prisma.dmReport.create({ data: { conversationId: id, reporterId: me, reason: reason?.slice(0, 200) ?? null } }).catch((error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    });
    if (a.isGroup) await this.leave(me, id);
    else await this.block(me, id, true);
    this.logger.warn({ conversationId: id, reporterId: me, group: a.isGroup }, 'Private chat reported');
  }

  // --- communities (2026-10-17, Discord-style) ---------------------------------------------

  /** A new community you own, with #general, #alpha and the 🔊 voice lounge, and an invite link. */
  async createCommunity(me: string, rawTitle: string): Promise<DmConversation> {
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    if (title.length === 0 || title.length > DM_LIMITS.groupTitleMax) throw new BadRequestException(`Give the community a name (up to ${DM_LIMITS.groupTitleMax} characters).`);
    if (containsLink(title)) throw new BadRequestException("Links aren't allowed in a name.");
    const myName = await this.requireUsername(me);
    const startedToday = await prisma.dmConversation.count({ where: { requesterId: me, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (startedToday >= DM_LIMITS.newPerDay) throw new HttpException("You've started a lot of new chats today — try again tomorrow.", HttpStatus.TOO_MANY_REQUESTS);
    const row = await prisma.dmConversation.create({
      data: {
        isGroup: true,
        isCommunity: true,
        title,
        ownerId: me,
        requesterId: me,
        status: 'active',
        inviteCode: inviteCode(),
        members: { create: [{ userId: me, role: 'owner', status: 'active', readAt: new Date() }] },
        channels: {
          create: [
            { name: 'general', kind: 'text', position: 0 },
            { name: 'alpha', kind: 'text', position: 1 },
            { name: 'Voice lounge', kind: 'voice', position: 2 },
          ],
        },
      },
    });
    await this.system(row.id, { event: 'createdCommunity', actor: myName, targets: [] });
    return this.conversation(me, row.id);
  }

  async createChannel(me: string, id: string, rawName: string, kind: 'text' | 'voice'): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    if (!a.row.isCommunity) throw new BadRequestException('Channels are for communities.');
    const name = rawName.trim().replace(/^#/, '').replace(/\s+/g, kind === 'text' ? '-' : ' ').toLowerCase().slice(0, DM_LIMITS.channelNameMax);
    if (!name || containsLink(name)) throw new BadRequestException('Give the channel a name.');
    if (kind === 'voice' && (await prisma.dmChannel.count({ where: { conversationId: id, kind: 'voice' } })) > 0) throw new BadRequestException('A community has one voice lounge.');
    const count = await prisma.dmChannel.count({ where: { conversationId: id } });
    if (count >= DM_LIMITS.maxChannels) throw new BadRequestException(`Up to ${DM_LIMITS.maxChannels} channels.`);
    await prisma.dmChannel.create({ data: { conversationId: id, name, kind, position: count } });
    await this.publish({ type: 'state', userIds: a.participants, conversationId: id });
    return this.conversation(me, id);
  }

  async deleteChannel(me: string, id: string, channelId: string): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    const channels = await prisma.dmChannel.findMany({ where: { conversationId: id, kind: 'text' }, orderBy: { position: 'asc' } });
    if (channels[0]?.id === channelId) throw new BadRequestException("The first channel can't be deleted.");
    await prisma.dmChannel.deleteMany({ where: { id: channelId, conversationId: id } });
    await this.publish({ type: 'state', userIds: a.participants, conversationId: id });
    return this.conversation(me, id);
  }

  /** What an invite link shows: name, size, a few faces — and whether you're already in. */
  async invitePreview(me: string, code: string): Promise<DmInvitePreview> {
    const row = await prisma.dmConversation.findUnique({ where: { inviteCode: code }, select: { id: true, title: true, isCommunity: true } });
    if (!row?.isCommunity) throw new NotFoundException('This invite link is not valid.');
    const members = await prisma.dmMember.findMany({ where: { conversationId: row.id, status: 'active' }, orderBy: { joinedAt: 'asc' }, select: { userId: true } });
    const faces = await prisma.user.findMany({ where: { id: { in: members.slice(0, 6).map((m) => m.userId) } }, select: { id: true, username: true, avatarUrl: true } });
    return {
      conversationId: row.id,
      title: row.title ?? 'Community',
      memberCount: members.length,
      members: faces.map((f) => ({ userId: f.id, username: f.username, avatarUrl: f.avatarUrl, walletAddress: null })),
      alreadyIn: members.some((m) => m.userId === me),
    };
  }

  /** Join with an invite link — you chose to, so you're in right away. */
  async joinByInvite(me: string, code: string): Promise<DmConversation> {
    const myName = await this.requireUsername(me);
    const row = await prisma.dmConversation.findUnique({ where: { inviteCode: code }, select: { id: true, isCommunity: true } });
    if (!row?.isCommunity) throw new NotFoundException('This invite link is not valid.');
    const existing = await prisma.dmMember.findUnique({ where: { conversationId_userId: { conversationId: row.id, userId: me } } });
    if (existing) {
      if (existing.status !== 'active') await prisma.dmMember.update({ where: { conversationId_userId: { conversationId: row.id, userId: me } }, data: { status: 'active' } });
      return this.conversation(me, row.id);
    }
    const count = await prisma.dmMember.count({ where: { conversationId: row.id, status: 'active' } });
    if (count >= DM_LIMITS.communityMaxMembers) throw new ForbiddenException('This community is full.');
    await prisma.dmMember.create({ data: { conversationId: row.id, userId: me, role: 'member', status: 'active', readAt: new Date() } });
    await this.system(row.id, { event: 'joined', actor: myName, targets: [] });
    return this.conversation(me, row.id);
  }

  /** A fresh invite link (the old one stops working). */
  async resetInvite(me: string, id: string): Promise<DmConversation> {
    const a = await this.access(me, id);
    this.requireOwner(a);
    if (!a.row.isCommunity) throw new BadRequestException('Invite links are for communities.');
    await prisma.dmConversation.update({ where: { id }, data: { inviteCode: inviteCode() } });
    return this.conversation(me, id);
  }

  /** The channel a message belongs to: the one asked for, else the first text channel. */
  private async channelOf(id: string, channelId?: string): Promise<{ id: string; kind: string } | null> {
    if (channelId) {
      const c = await prisma.dmChannel.findFirst({ where: { id: channelId, conversationId: id }, select: { id: true, kind: true } });
      if (!c) throw new NotFoundException('Channel not found.');
      return c;
    }
    return prisma.dmChannel.findFirst({ where: { conversationId: id, kind: 'text' }, orderBy: { position: 'asc' }, select: { id: true, kind: true } });
  }

  // --- for calls -------------------------------------------------------------------------

  /** Who may be in a call in this chat — only accepted chats (owner's rule 2026-10-17): a 1:1
   *  chat that's active and not blocked, or a group you're an active member of. */
  async callAccess(me: string, id: string): Promise<{ isGroup: boolean; isCommunity: boolean; participants: string[] }> {
    const a = await this.access(me, id);
    if (a.isGroup) {
      if (a.myStatus !== 'active') throw new ForbiddenException('Accept the invite first.');
    } else {
      if (a.row.status !== 'active') throw new ForbiddenException('You can call once they accept your message request.');
      if (a.otherId && (await this.blockedEitherWay(me, a.otherId))) throw new ForbiddenException("You can't call this user.");
    }
    return { isGroup: a.isGroup, isCommunity: a.row.isCommunity, participants: a.participants };
  }

  /** A server-written line in a chat (a call that ended or was missed). */
  async postSystem(id: string, event: DmSystem): Promise<void> {
    const a = await prisma.dmConversation.findUnique({ where: { id }, select: { isGroup: true, userAId: true, userBId: true } });
    if (!a) return;
    await this.system(id, event, a.isGroup ? [] : [a.userAId!, a.userBId!]);
  }

  async publishEvent(event: DmEvent): Promise<void> {
    await this.publish(event);
  }

  // --- internals ---------------------------------------------------------------------------

  private async write(
    me: string,
    id: string,
    message: { kind: DmMessageKind; body: string; data: unknown; txRef?: string; channelId?: string },
    opts: { skipPush?: boolean } = {},
  ): Promise<DmMessage> {
    const a = await this.access(me, id);
    const channel = a.row.isCommunity ? await this.channelOf(id, message.channelId) : null;
    if (channel && channel.kind !== 'text') throw new BadRequestException('Write in a text channel.');
    if (a.isGroup && a.myStatus !== 'active') throw new ForbiddenException('Accept the invite to write in this group.');
    if (!a.isGroup && a.otherId && (await this.blockedEitherWay(me, a.otherId))) throw new ForbiddenException("You can't message this user.");

    const cooled = await this.redis.set(`kamby:dm:cool:${me}`, '1', 'PX', DM_LIMITS.cooldownMs, 'NX').catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);

    let status = a.row.status;
    if (!a.isGroup && status === 'request') {
      if (a.row.requesterId === me) {
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
    const created = await prisma.dmMessage.create({
      data: {
        conversationId: id,
        senderId: me,
        kind: message.kind,
        body: message.body,
        data: message.data === null ? Prisma.JsonNull : (message.data as Prisma.InputJsonValue),
        txRef: message.txRef ?? null,
        channelId: channel?.id ?? null,
      },
    });
    if (a.isGroup) {
      await prisma.$transaction([
        prisma.dmConversation.update({ where: { id }, data: { lastMessageAt: at } }),
        prisma.dmMember.update({ where: { conversationId_userId: { conversationId: id, userId: me } }, data: { readAt: at } }),
      ]);
    } else {
      await prisma.dmConversation.update({ where: { id }, data: { lastMessageAt: at, status, ...(a.row.userAId === me ? { aReadAt: at } : { bReadAt: at }) } });
    }
    const dto = toMessage(created);
    await this.publish({ type: 'message', userIds: a.participants, conversationId: id, message: dto });
    if (status !== a.row.status) await this.publish({ type: 'state', userIds: a.participants, conversationId: id });
    // Pushes go out after the reply to the sender — sending never waits on them.
    if (!opts.skipPush) void this.pushForMessage(me, a, created).catch((error: unknown) => this.logger.warn({ err: error }, 'DM push failed'));
    return dto;
  }

  /**
   * Phone pushes for a new line (2026-10-17, "notifications from anything"):
   * - @mentions and replies always buzz the person they're for;
   * - a private chat buzzes for every line (at most one per 15 s, so a burst is one buzz);
   * - a group at most once a minute per person, a community once every 10 minutes;
   * - nobody is buzzed for the chat they're looking at right now.
   */
  private async pushForMessage(me: string, a: Access, created: DmMessageRow): Promise<void> {
    const others = a.participants.filter((u) => u !== me);
    if (others.length === 0) return;
    const text = created.kind === 'text' ? created.body : '';
    const data = (created.data ?? null) as { replyTo?: DmReplyRef } | null;
    const replyTarget = data?.replyTo?.senderId ?? null;
    const names = text ? dmMentions(text) : [];
    const mentioned = names.length
      ? await prisma.user.findMany({ where: { id: { in: others }, username: { in: names, mode: 'insensitive' } }, select: { id: true } })
      : [];
    const pinged = new Set(mentioned.map((u) => u.id));
    if (replyTarget && others.includes(replyTarget)) pinged.add(replyTarget);
    const line = preview(created);
    for (const userId of pinged) {
      const kind = mentioned.some((u) => u.id === userId) ? 'mention' : 'reply';
      await this.notifyChat([userId], me, a.row, { dmKind: kind, preview: line }, () => `ping:${created.id}`);
    }
    const rest = others.filter((u) => !pinged.has(u));
    const windowMs = a.row.isCommunity ? 10 * 60_000 : a.isGroup ? 60_000 : 15_000;
    const fresh = await Promise.all(rest.map((u) => this.redis.set(`kamby:dm:push:${a.row.id}:${u}`, '1', 'PX', windowMs, 'NX').catch(() => 'OK')));
    await this.notifyChat(
      rest.filter((_, i) => fresh[i] === 'OK'),
      me,
      a.row,
      { dmKind: 'message', preview: line },
      () => `msg:${created.id}`,
    );
  }

  /** One DM_MESSAGE push per person, with the chat, its name and the line — skipping anyone who
   *  has this chat open right now (they see it arrive). */
  private async notifyChat(
    targets: string[],
    me: string,
    row: DmConversationRow,
    extra: { dmKind: 'message' | 'mention' | 'reply' | 'reaction' | 'added' | 'accepted'; preview?: string; emoji?: string },
    dedupe: (userId: string) => string,
  ): Promise<void> {
    if (targets.length === 0) return;
    const viewing = await this.redis.mget(...targets.map((u) => `kamby:dm:viewing:${u}`)).catch(() => targets.map(() => null));
    const chatTitle = row.isGroup ? (row.title ?? null) : null;
    await Promise.all(
      targets
        .filter((_, i) => viewing[i] !== row.id)
        .map((userId) =>
          this.notifications
            .create({
              userId,
              type: 'DM_MESSAGE',
              dedupeKey: dedupe(userId),
              actorUserId: me,
              payload: { conversationId: row.id, chatTitle, preview: (extra.preview ?? '').slice(0, 120), dmKind: extra.dmKind, ...(extra.emoji ? { emoji: extra.emoji } : {}) },
            })
            .catch((error: unknown) => this.logger.warn({ err: error }, 'DM push notification failed')),
        ),
    );
  }

  /** Kamby is open on this device (and maybe this chat) — the green dot, and no push for the
   *  chat you're reading. */
  async presence(me: string, viewing?: string): Promise<void> {
    await this.redis.set(`kamby:online:${me}`, '1', 'EX', DM_PRESENCE.onlineTtlSec).catch(() => undefined);
    if (viewing) await this.redis.set(`kamby:dm:viewing:${me}`, viewing, 'EX', DM_PRESENCE.viewingTtlSec).catch(() => undefined);
    else await this.redis.del(`kamby:dm:viewing:${me}`).catch(() => undefined);
  }

  /** A group event line, written by the server (no cooldown, no push). */
  private async system(id: string, event: DmSystem, extraUserIds: string[] = []): Promise<void> {
    const row = await prisma.dmMessage.create({ data: { conversationId: id, senderId: 'system', kind: 'system', body: '', data: event as unknown as Prisma.InputJsonValue } });
    await prisma.dmConversation.update({ where: { id }, data: { lastMessageAt: row.createdAt } });
    const members = await prisma.dmMember.findMany({ where: { conversationId: id }, select: { userId: true } });
    const userIds = [...new Set([...members.map((m) => m.userId), ...extraUserIds])];
    await this.publish({ type: 'message', userIds, conversationId: id, message: toMessage(row) });
    await this.publish({ type: 'state', userIds, conversationId: id });
  }

  private async access(me: string, id: string): Promise<Access> {
    const row = await prisma.dmConversation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Chat not found.');
    if (!row.isGroup) {
      if (row.userAId !== me && row.userBId !== me) throw new NotFoundException('Chat not found.');
      const otherId = (row.userAId === me ? row.userBId : row.userAId) ?? null;
      return { row, isGroup: false, myRole: null, myStatus: 'active', participants: [row.userAId!, row.userBId!], otherId };
    }
    const members = await prisma.dmMember.findMany({ where: { conversationId: id }, select: { userId: true, role: true, status: true } });
    const mine = members.find((m) => m.userId === me);
    if (!mine) throw new NotFoundException('Chat not found.');
    return {
      row,
      isGroup: true,
      myRole: mine.role === 'owner' ? 'owner' : 'member',
      myStatus: mine.status === 'invited' ? 'invited' : 'active',
      participants: members.filter((m) => m.status === 'active').map((m) => m.userId),
      otherId: null,
    };
  }

  private requireOwner(a: Access): void {
    if (!a.isGroup) throw new BadRequestException('This is not a group.');
    if (a.myRole !== 'owner') throw new ForbiddenException('Only the group admin can do that.');
  }

  private async requireUsername(me: string): Promise<string> {
    const row = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!row?.username) throw new ForbiddenException('Set a username in your profile to send messages.');
    return row.username;
  }

  /** @names → users, without you, duplicates, or anyone blocked either way. */
  private async resolveInvitees(me: string, usernames: string[]): Promise<{ id: string; username: string }[]> {
    const names = [...new Set(usernames.map((u) => u.replace(/^@/, '').trim().toLowerCase()).filter(Boolean))].slice(0, DM_LIMITS.groupMaxMembers);
    const users = await prisma.user.findMany({ where: { username: { in: names } }, select: { id: true, username: true } });
    const missing = names.filter((n) => !users.some((u) => u.username === n));
    if (missing.length > 0) throw new NotFoundException(`No Kamby user named @${missing[0]}.`);
    const blocks = await prisma.userBlock.findMany({
      where: { OR: [{ blockerId: me, blockedId: { in: users.map((u) => u.id) } }, { blockedId: me, blockerId: { in: users.map((u) => u.id) } }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set(blocks.map((b) => (b.blockerId === me ? b.blockedId : b.blockerId)));
    return users.filter((u) => u.id !== me && !blocked.has(u.id)).map((u) => ({ id: u.id, username: u.username! }));
  }

  /** Which of `userIds` follow `me` (any of my wallets) — they join a group of mine right away. */
  private async followersOf(me: string, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await prisma.follow.findMany({ where: { userId: { in: userIds }, wallet: { userId: me } }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
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
    const pairRows = rows.filter((r) => !r.isGroup);
    const groupIds = rows.filter((r) => r.isGroup).map((r) => r.id);
    const [lasts, pairUnread, groupUnread, members] = await Promise.all([
      prisma.dmMessage.findMany({ where: { conversationId: { in: ids } }, orderBy: [{ conversationId: 'asc' }, { createdAt: 'desc' }], distinct: ['conversationId'] }),
      pairRows.length === 0
        ? Promise.resolve([] as { id: string; n: bigint }[])
        : prisma.$queryRaw<{ id: string; n: bigint }[]>`
            SELECT c.id, COUNT(m.id) AS n
            FROM dm_conversations c
            JOIN dm_messages m ON m.conversation_id = c.id
            WHERE c.id IN (${Prisma.join(pairRows.map((r) => r.id))})
              AND m.sender_id <> ${me}
              AND m.created_at > COALESCE(CASE WHEN c.user_a_id = ${me} THEN c.a_read_at ELSE c.b_read_at END, 'epoch'::timestamp)
            GROUP BY c.id`,
      groupIds.length === 0
        ? Promise.resolve([] as { id: string; n: bigint }[])
        : prisma.$queryRaw<{ id: string; n: bigint }[]>`
            SELECT dm.conversation_id AS id, COUNT(m.id) AS n
            FROM dm_members dm
            JOIN dm_messages m ON m.conversation_id = dm.conversation_id
            WHERE dm.conversation_id IN (${Prisma.join(groupIds)})
              AND dm.user_id = ${me}
              AND m.sender_id <> ${me}
              AND m.kind <> 'system'
              AND m.created_at > COALESCE(dm.read_at, 'epoch'::timestamp)
            GROUP BY dm.conversation_id`,
      groupIds.length === 0 ? Promise.resolve([]) : prisma.dmMember.findMany({ where: { conversationId: { in: groupIds } }, orderBy: { joinedAt: 'asc' } }),
    ]);
    const communityIds = rows.filter((r) => r.isCommunity).map((r) => r.id);
    const channels = communityIds.length
      ? await prisma.dmChannel.findMany({ where: { conversationId: { in: communityIds } }, orderBy: { position: 'asc' }, select: { id: true, conversationId: true, name: true, kind: true } })
      : [];
    const otherIds = pairRows.map((r) => (r.userAId === me ? r.userBId : r.userAId)).filter((x): x is string => Boolean(x));
    const personIds = [...new Set([...otherIds, ...members.map((m) => m.userId)])];
    const [people, blocks] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: personIds } },
        select: { id: true, username: true, avatarUrl: true, wallets: { where: { verifiedAt: { not: null } }, select: { address: true }, orderBy: { verifiedAt: 'asc' }, take: 1 } },
      }),
      prisma.userBlock.findMany({ where: { blockerId: me, blockedId: { in: otherIds } }, select: { blockedId: true } }),
    ]);
    const onlineFlags = personIds.length ? await this.redis.mget(...personIds.map((u) => `kamby:online:${u}`)).catch(() => personIds.map(() => null)) : [];
    const online = new Set(personIds.filter((_, i) => onlineFlags[i]));
    const lastBy = new Map(lasts.map((m) => [m.conversationId, m]));
    const unreadBy = new Map([...pairUnread, ...groupUnread].map((u) => [u.id, Number(u.n)]));
    const personBy = new Map<string, DmPerson>(
      people.map((p) => [p.id, { userId: p.id, username: p.username, avatarUrl: p.avatarUrl, walletAddress: p.wallets[0]?.address ?? null }]),
    );
    const person = (id: string): DmPerson => personBy.get(id) ?? { userId: id, username: null, avatarUrl: null, walletAddress: null };
    const blocked = new Set(blocks.map((b) => b.blockedId));
    return rows.map((r): DmConversation => {
      const last = lastBy.get(r.id);
      const lastMessage = last ? { body: preview(last), kind: last.kind as DmMessageKind, senderId: last.senderId, createdAt: last.createdAt.toISOString() } : null;
      if (r.isGroup) {
        const rowMembers = members.filter((m) => m.conversationId === r.id);
        const mine = rowMembers.find((m) => m.userId === me);
        return {
          id: r.id,
          meId: me,
          state: mine?.status === 'invited' ? 'request' : 'active',
          other: null,
          group: {
            title: r.title ?? 'Group',
            ownerId: r.ownerId ?? '',
            members: rowMembers.filter((m) => m.status === 'active').map((m) => person(m.userId)),
            community: r.isCommunity
              ? {
                  inviteCode: r.inviteCode,
                  channels: channels.filter((c) => c.conversationId === r.id).map((c): DmChannelInfo => ({ id: c.id, name: c.name, kind: c.kind === 'voice' ? 'voice' : 'text' })),
                }
              : null,
          },
          lastMessage,
          unread: unreadBy.get(r.id) ?? 0,
          otherReadAt: null,
          blocked: false,
          onlineIds: rowMembers.filter((m) => m.status === 'active' && m.userId !== me && online.has(m.userId)).map((m) => m.userId),
        };
      }
      const otherId = (r.userAId === me ? r.userBId : r.userAId) ?? '';
      const otherReadAt = r.userAId === me ? r.bReadAt : r.aReadAt;
      return {
        id: r.id,
        meId: me,
        state: r.status === 'active' ? 'active' : r.requesterId === me ? 'pending' : 'request',
        other: person(otherId),
        group: null,
        lastMessage,
        unread: unreadBy.get(r.id) ?? 0,
        otherReadAt: otherReadAt ? otherReadAt.toISOString() : null,
        blocked: blocked.has(otherId),
        onlineIds: online.has(otherId) && !blocked.has(otherId) ? [otherId] : [],
      };
    });
  }

  private async publish(event: DmEvent): Promise<void> {
    await this.redis.publish(DM_REALTIME_CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'DM realtime publish failed — the other side gets it on their next load');
    });
  }
}
