import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma } from '@kamby/db';
import {
  containsLink,
  isChatTokenKey,
  LIVE_LIMITS,
  LIVE_REALTIME_CHANNEL,
  type LiveChatLine,
  type LiveEvent,
  type LiveHost,
  type LiveRoom,
  type LiveTrackKind,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { CloudflareRealtimeClient, type RealtimeTracksResponse, type SessionDescription } from '../calls/cloudflare-realtime.client';
import { REDIS_CLIENT } from '../redis/redis.module';

/** What Redis keeps for a room that's on air (the app sees LiveRoom). */
interface LiveState {
  id: string;
  title: string;
  host: LiveHost;
  coin: LiveRoom['coin'];
  startedAt: string;
  hostSessionId: string | null;
  tracks: { trackName: string; kind: LiveTrackKind }[];
  muted: boolean;
  peak: number;
}

const KINDS: readonly LiveTrackKind[] = ['audio', 'screen'];
const ACTIVE_SET = 'kamby:live:active';

/**
 * Live rooms (2026-10-17) — see @kamby/domain live.ts. The host publishes voice + screen to
 * Cloudflare Realtime through here (only their own tracks, no camera); signed-in viewers pull
 * only the host's tracks. Who's watching is a Redis sorted set of heartbeats; a host who stops
 * checking in ends the room. Chat is kept in Redis (the last few dozen lines), no links, a
 * short cooldown. Three reports from different viewers end the room.
 */
@Injectable()
export class LiveService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly realtime: CloudflareRealtimeClient,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('LiveService');
  }

  // --- reading -----------------------------------------------------------------------------

  async list(): Promise<LiveRoom[]> {
    const ids = await this.redis.smembers(ACTIVE_SET).catch(() => [] as string[]);
    const rooms = await Promise.all(ids.map((id) => this.room(id)));
    return rooms.filter((r): r is LiveRoom => Boolean(r)).sort((a, b) => b.viewers - a.viewers);
  }

  async get(id: string): Promise<LiveRoom> {
    const room = await this.room(id);
    if (!room) throw new NotFoundException('This live has ended.');
    return room;
  }

  async chat(id: string): Promise<LiveChatLine[]> {
    const raw = await this.redis.lrange(this.chatKey(id), 0, LIVE_LIMITS.chatKeep - 1).catch(() => [] as string[]);
    return raw.map((r) => JSON.parse(r) as LiveChatLine).reverse();
  }

  // --- host --------------------------------------------------------------------------------

  async start(me: string, rawTitle: string, tokenKey?: string): Promise<{ room: LiveRoom; sessionId: string; iceServers: unknown[] }> {
    if (!this.realtime.enabled) throw new ServiceUnavailableException('Live is not available right now.');
    const title = rawTitle.replace(/\s+/g, ' ').trim();
    if (!title || title.length > LIVE_LIMITS.titleMax) throw new BadRequestException(`Give your live a title (up to ${LIVE_LIMITS.titleMax} characters).`);
    if (containsLink(title)) throw new BadRequestException("Links aren't allowed in a live title.");
    if (tokenKey && !isChatTokenKey(tokenKey)) throw new BadRequestException('Unknown coin.');
    const host = await this.person(me);
    if (!host) throw new ForbiddenException('Set a username in your profile to go live.');
    // One live per person.
    const ids = await this.redis.smembers(ACTIVE_SET).catch(() => [] as string[]);
    for (const id of ids) {
      const s = await this.read(id);
      if (s?.host.userId === me) await this.end(id, 'host');
    }

    const row = await prisma.liveRoom.create({ data: { hostId: me, title, tokenKey: tokenKey ?? null } });
    const [sessionId, iceServers] = await Promise.all([this.realtime.newSession(), this.realtime.iceServers()]);
    const state: LiveState = {
      id: row.id,
      title,
      host,
      coin: tokenKey ? await this.coin(tokenKey) : null,
      startedAt: row.startedAt.toISOString(),
      hostSessionId: sessionId,
      tracks: [],
      muted: false,
      peak: 0,
    };
    await this.write(state);
    await this.redis.sadd(ACTIVE_SET, row.id);
    await this.hostSeen(row.id);
    const room = await this.toRoom(state);
    await this.publish({ type: 'room', roomId: row.id, room });
    return { room, sessionId, iceServers };
  }

  async publishTracks(me: string, id: string, body: { sessionDescription: SessionDescription; tracks: { mid: string; trackName: string; kind: LiveTrackKind }[] }): Promise<RealtimeTracksResponse> {
    const state = await this.hostState(me, id);
    for (const t of body.tracks) {
      if (!KINDS.includes(t.kind) || !t.trackName.startsWith(`${me}:${t.kind}:`)) throw new BadRequestException('Bad track.');
    }
    const res = await this.realtime.tracksNew(state.hostSessionId!, {
      sessionDescription: body.sessionDescription,
      tracks: body.tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
    });
    state.tracks = [...state.tracks.filter((t) => !body.tracks.some((n) => n.trackName === t.trackName)), ...body.tracks.map((t) => ({ trackName: t.trackName, kind: t.kind }))];
    await this.write(state);
    await this.publish({ type: 'room', roomId: id, room: await this.toRoom(state) });
    return res;
  }

  async closeTracks(me: string, id: string, body: { mids: string[]; trackNames: string[]; sessionDescription?: SessionDescription }): Promise<RealtimeTracksResponse> {
    const state = await this.hostState(me, id);
    const res = await this.realtime.tracksClose(state.hostSessionId!, {
      tracks: body.mids.map((mid) => ({ mid })),
      ...(body.sessionDescription ? { sessionDescription: body.sessionDescription } : {}),
      force: !body.sessionDescription,
    });
    state.tracks = state.tracks.filter((t) => !body.trackNames.includes(t.trackName));
    await this.write(state);
    await this.publish({ type: 'room', roomId: id, room: await this.toRoom(state) });
    return res;
  }

  async hostRenegotiate(me: string, id: string, sessionDescription: SessionDescription): Promise<RealtimeTracksResponse> {
    const state = await this.hostState(me, id);
    return this.realtime.renegotiate(state.hostSessionId!, { sessionDescription });
  }

  async mute(me: string, id: string, muted: boolean): Promise<void> {
    const state = await this.hostState(me, id);
    state.muted = muted;
    await this.write(state);
    await this.publish({ type: 'room', roomId: id, room: await this.toRoom(state) });
  }

  async stop(me: string, id: string): Promise<void> {
    await this.hostState(me, id);
    await this.end(id, 'host');
  }

  // --- viewers -----------------------------------------------------------------------------

  /** A viewer's own Cloudflare session (receive-only) — then they pull the host's tracks. */
  async watch(me: string, id: string): Promise<{ room: LiveRoom; sessionId: string; iceServers: unknown[] }> {
    if (!this.realtime.enabled) throw new ServiceUnavailableException('Live is not available right now.');
    const state = await this.tidy(id);
    if (!state) throw new NotFoundException('This live has ended.');
    const [sessionId, iceServers] = await Promise.all([this.realtime.newSession(), this.realtime.iceServers()]);
    await this.redis.set(this.viewerSessionKey(id, me), sessionId, 'EX', 6 * 3600);
    await this.viewerSeen(id, me);
    return { room: await this.toRoom(state), sessionId, iceServers };
  }

  async pull(me: string, id: string, trackNames: string[]): Promise<RealtimeTracksResponse> {
    const state = await this.read(id);
    if (!state?.hostSessionId) throw new NotFoundException('This live has ended.');
    const sessionId = await this.redis.get(this.viewerSessionKey(id, me));
    if (!sessionId) throw new ForbiddenException('Open the live first.');
    if (trackNames.some((n) => !state.tracks.some((t) => t.trackName === n))) throw new BadRequestException('That track is not in this live.');
    return this.realtime.tracksNew(sessionId, { tracks: trackNames.map((trackName) => ({ location: 'remote', sessionId: state.hostSessionId, trackName })) });
  }

  async viewerRenegotiate(me: string, id: string, sessionDescription: SessionDescription): Promise<RealtimeTracksResponse> {
    const sessionId = await this.redis.get(this.viewerSessionKey(id, me));
    if (!sessionId) throw new ForbiddenException('Open the live first.');
    return this.realtime.renegotiate(sessionId, { sessionDescription });
  }

  /** Host or viewer: still here. Returns the room (or null once it's over). */
  async heartbeat(me: string, id: string): Promise<LiveRoom | null> {
    const state = await this.tidy(id);
    if (!state) return null;
    if (state.host.userId === me) await this.hostSeen(id);
    else await this.viewerSeen(id, me);
    const room = await this.toRoom(state);
    if (room.viewers > state.peak) {
      state.peak = room.viewers;
      await this.write(state);
      await prisma.liveRoom.update({ where: { id }, data: { peakViewers: room.viewers } }).catch(() => undefined);
    }
    return room;
  }

  async leave(me: string, id: string): Promise<void> {
    await this.redis.zrem(this.viewersKey(id), me).catch(() => 0);
    await this.redis.del(this.viewerSessionKey(id, me)).catch(() => 0);
  }

  async say(me: string, id: string, rawBody: string): Promise<LiveChatLine> {
    const state = await this.read(id);
    if (!state) throw new NotFoundException('This live has ended.');
    const body = rawBody.replace(/\s+/g, ' ').trim();
    if (!body) throw new BadRequestException('Write something first.');
    if (body.length > LIVE_LIMITS.chatMax) throw new BadRequestException(`Keep it under ${LIVE_LIMITS.chatMax} characters.`);
    if (containsLink(body)) throw new BadRequestException("Links aren't allowed in live chat.");
    const who = await this.person(me);
    if (!who) throw new ForbiddenException('Set a username in your profile to chat.');
    const ok = await this.redis.set(`kamby:live:cool:${me}`, '1', 'PX', LIVE_LIMITS.chatCooldownMs, 'NX').catch(() => 'OK');
    if (ok !== 'OK') throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);
    const line: LiveChatLine = { id: randomUUID(), userId: me, username: who.username, avatarUrl: who.avatarUrl, body, at: new Date().toISOString(), host: me === state.host.userId };
    await this.redis.lpush(this.chatKey(id), JSON.stringify(line));
    await this.redis.ltrim(this.chatKey(id), 0, LIVE_LIMITS.chatKeep - 1);
    await this.redis.expire(this.chatKey(id), 12 * 3600);
    await this.publish({ type: 'chat', roomId: id, line });
    return line;
  }

  /** Three reports from different viewers end the room (kept for review). */
  async report(me: string, id: string): Promise<{ ended: boolean }> {
    const state = await this.read(id);
    if (!state) return { ended: true };
    if (state.host.userId === me) throw new BadRequestException("You can't report your own live.");
    await prisma.liveReport.create({ data: { roomId: id, reporterId: me } }).catch(() => undefined);
    const n = await prisma.liveReport.count({ where: { roomId: id } });
    this.logger.warn({ roomId: id, reports: n }, 'Live room reported');
    if (n >= LIVE_LIMITS.reportsToEnd) {
      await this.end(id, 'reports');
      return { ended: true };
    }
    return { ended: false };
  }

  // --- internals ---------------------------------------------------------------------------

  private key(id: string) {
    return `kamby:live:${id}`;
  }
  private viewersKey(id: string) {
    return `kamby:live:${id}:viewers`;
  }
  private viewerSessionKey(id: string, userId: string) {
    return `kamby:live:${id}:session:${userId}`;
  }
  private chatKey(id: string) {
    return `kamby:live:${id}:chat`;
  }
  private hostSeenKey(id: string) {
    return `kamby:live:${id}:host`;
  }

  private async read(id: string): Promise<LiveState | null> {
    const raw = await this.redis.get(this.key(id)).catch(() => null);
    return raw ? (JSON.parse(raw) as LiveState) : null;
  }

  private async write(state: LiveState): Promise<void> {
    await this.redis.set(this.key(state.id), JSON.stringify(state), 'EX', 12 * 3600);
  }

  private async hostState(me: string, id: string): Promise<LiveState> {
    const state = await this.read(id);
    if (!state) throw new NotFoundException('This live has ended.');
    if (state.host.userId !== me) throw new ForbiddenException('Only the host can do that.');
    return state;
  }

  private async hostSeen(id: string): Promise<void> {
    await this.redis.set(this.hostSeenKey(id), String(Date.now()), 'EX', 12 * 3600).catch(() => undefined);
  }

  private async viewerSeen(id: string, userId: string): Promise<void> {
    await this.redis.zadd(this.viewersKey(id), Date.now(), userId).catch(() => 0);
    await this.redis.expire(this.viewersKey(id), 12 * 3600).catch(() => 0);
  }

  /** Ends a room whose host stopped checking in. */
  private async tidy(id: string): Promise<LiveState | null> {
    const state = await this.read(id);
    if (!state) return null;
    const last = Number((await this.redis.get(this.hostSeenKey(id)).catch(() => null)) ?? 0);
    if (Date.now() - last > LIVE_LIMITS.hostStaleMs) {
      await this.end(id, 'dropped');
      return null;
    }
    return state;
  }

  private async room(id: string): Promise<LiveRoom | null> {
    const state = await this.tidy(id);
    return state ? this.toRoom(state) : null;
  }

  private async toRoom(state: LiveState): Promise<LiveRoom> {
    await this.redis.zremrangebyscore(this.viewersKey(state.id), 0, Date.now() - LIVE_LIMITS.viewerStaleMs).catch(() => 0);
    const viewers = await this.redis.zcard(this.viewersKey(state.id)).catch(() => 0);
    return {
      id: state.id,
      title: state.title,
      host: state.host,
      coin: state.coin,
      startedAt: state.startedAt,
      viewers,
      hostSessionId: state.hostSessionId,
      tracks: state.tracks,
      muted: state.muted,
    };
  }

  private async end(id: string, reason: 'host' | 'dropped' | 'reports'): Promise<void> {
    await this.redis.srem(ACTIVE_SET, id).catch(() => 0);
    await this.redis.del(this.key(id), this.viewersKey(id), this.hostSeenKey(id)).catch(() => 0);
    await prisma.liveRoom.updateMany({ where: { id, endedAt: null }, data: { endedAt: new Date(), endedReason: reason } }).catch(() => undefined);
    await this.publish({ type: 'ended', roomId: id });
  }

  private async person(userId: string): Promise<LiveHost | null> {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, avatarUrl: true, wallets: { where: { verifiedAt: { not: null } }, select: { address: true }, orderBy: { verifiedAt: 'asc' }, take: 1 } },
    });
    return u?.username ? { userId, username: u.username, avatarUrl: u.avatarUrl, walletAddress: u.wallets[0]?.address ?? null } : null;
  }

  private async coin(tokenKey: string): Promise<LiveRoom['coin']> {
    if (tokenKey.startsWith('solana:')) {
      const mint = tokenKey.slice('solana:'.length);
      const [m, p] = await Promise.all([
        prisma.solanaTokenMarket.findUnique({ where: { mintAddress: mint }, select: { symbol: true, logoUrl: true } }),
        prisma.pumpFunToken.findUnique({ where: { mintAddress: mint }, select: { symbol: true } }),
      ]);
      return { chainIdentifier: 'solana', tokenAddress: mint, symbol: m?.symbol ?? p?.symbol ?? null, logoUrl: m?.logoUrl ?? null };
    }
    const [, chainId, address] = tokenKey.split(':');
    const chainIdentifier = `eip155:${chainId}`;
    const t = await prisma.token.findFirst({ where: { contractAddress: { equals: address, mode: 'insensitive' }, chain: { identifier: chainIdentifier } }, select: { symbol: true, logoUrl: true } });
    return { chainIdentifier, tokenAddress: address!, symbol: t?.symbol ?? null, logoUrl: t?.logoUrl ?? null };
  }

  private async publish(event: LiveEvent): Promise<void> {
    await this.redis.publish(LIVE_REALTIME_CHANNEL, JSON.stringify(event)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Live realtime publish failed');
    });
  }
}
