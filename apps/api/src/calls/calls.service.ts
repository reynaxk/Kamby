import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma } from '@kamby/db';
import { CALL_LIMITS, type CallJoin, type CallParticipant, type CallState, type CallTrackKind } from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { DmService } from '../dm/dm.service';
import { NotificationService } from '../notifications/notification.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { CloudflareRealtimeClient, type RealtimeTracksResponse, type SessionDescription } from './cloudflare-realtime.client';

/** What we keep per call (the app sees CallState). */
interface CallRecord extends CallState {
  /** Someone besides the caller joined — decides "Call · 12 min" vs "Missed call". */
  answered: boolean;
}

/** Rough bitrates for the traffic meter (Cloudflare bills what the SFU sends out). */
const KBPS: Record<CallTrackKind, number> = { audio: 40, video: 1200, screen: 800 };

const KINDS: readonly CallTrackKind[] = ['audio', 'video', 'screen'];

/** Exported for tests. The bytes one person downloads for `seconds` in this call. */
export function downloadBytes(call: CallState, userId: string, seconds: number): number {
  const kbps = call.participants.filter((p) => p.userId !== userId).reduce((sum, p) => sum + p.tracks.reduce((s, t) => s + KBPS[t.kind], 0), 0);
  return Math.round((kbps * 1000 * seconds) / 8);
}

/** Exported for tests. Whether one more camera fits (owner's rule: at most 8 at once). */
export function cameraFits(call: CallState): boolean {
  return call.participants.reduce((n, p) => n + p.tracks.filter((t) => t.kind === 'video').length, 0) < CALL_LIMITS.maxCameras;
}

const toState = ({ answered: _answered, ...state }: CallRecord): CallState => state;

/**
 * Calls (2026-10-17) — see @kamby/domain calls.ts. One live call per chat, kept in Redis. The
 * browser talks WebRTC to Cloudflare Realtime, but every session / track request goes through
 * here so nobody can publish under someone else's name or pull tracks from a call they're not
 * in. Changes go out on the private stream (DmEvent 'call'); people being rung also get a push.
 * A call ends when the last person leaves (or nobody answers in time) and leaves a line in the
 * chat ("Call · 12 min" / "Missed call").
 */
@Injectable()
export class CallsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly realtime: CloudflareRealtimeClient,
    private readonly dm: DmService,
    private readonly notifications: NotificationService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('CallsService');
  }

  async get(me: string, conversationId: string): Promise<CallState | null> {
    await this.dm.callAccess(me, conversationId);
    const call = await this.tidy(conversationId);
    return call ? toState(call) : null;
  }

  /** Start a call in this chat (or join the one already going). */
  async start(me: string, conversationId: string, video: boolean): Promise<CallJoin> {
    if (!this.realtime.enabled) throw new ServiceUnavailableException('Calls are not available right now.');
    const { participants, isCommunity } = await this.dm.callAccess(me, conversationId);
    let created: CallRecord | null = null;
    await this.mutate(conversationId, (call) => {
      if (call) return call;
      created = {
        id: randomUUID(),
        conversationId,
        startedBy: me,
        startedAt: new Date().toISOString(),
        video,
        participants: [],
        // A community's voice lounge rings nobody — people drop in when they see it's on.
        ringing: isCommunity ? [] : participants.filter((u) => u !== me),
        answered: false,
        ...(isCommunity ? { lounge: true } : {}),
      };
      return created;
    });
    if (created) {
      const call: CallRecord = created;
      for (const userId of call.ringing) {
        await this.notifications
          .create({ userId, type: 'CALL_INCOMING', dedupeKey: `call:${call.id}:${userId}`, actorUserId: me, payload: { conversationId } })
          .catch((error: unknown) => this.logger.warn({ err: error }, 'Call push failed'));
      }
    }
    return this.join(me, conversationId);
  }

  async join(me: string, conversationId: string): Promise<CallJoin> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const existing = await this.tidy(conversationId);
    if (!existing) throw new NotFoundException('This call has ended.');
    if (existing.participants.length >= CALL_LIMITS.maxParticipants && !existing.participants.some((p) => p.userId === me)) {
      throw new ForbiddenException(`A call can have up to ${CALL_LIMITS.maxParticipants} people.`);
    }
    const [sessionId, iceServers] = await Promise.all([this.realtime.newSession(), this.realtime.iceServers()]);
    const call = await this.mutate(conversationId, (c) => {
      if (!c) return null;
      const others = c.participants.filter((p) => p.userId !== me);
      const mine: CallParticipant = { userId: me, sessionId, joinedAt: new Date().toISOString(), tracks: [], muted: false };
      return { ...c, participants: [...others, mine], ringing: c.ringing.filter((u) => u !== me), answered: c.answered || me !== c.startedBy };
    });
    if (!call) throw new NotFoundException('This call has ended.');
    await this.seen(conversationId, me);
    await this.broadcast(conversationId, participants, call);
    return { call: toState(call), sessionId, iceServers };
  }

  /** Send my tracks: forwards the browser's offer, after checking every track is mine. */
  async publish(
    me: string,
    conversationId: string,
    body: { sessionDescription: SessionDescription; tracks: { mid: string; trackName: string; kind: CallTrackKind }[] },
  ): Promise<RealtimeTracksResponse> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const call = await this.tidy(conversationId);
    const mine = call?.participants.find((p) => p.userId === me);
    if (!call || !mine) throw new NotFoundException("You're not in this call.");
    for (const t of body.tracks) {
      if (!KINDS.includes(t.kind) || !t.trackName.startsWith(`${me}:${t.kind}:`)) throw new BadRequestException('Bad track.');
    }
    if (body.tracks.some((t) => t.kind === 'video') && !cameraFits(call)) {
      throw new ForbiddenException(`Up to ${CALL_LIMITS.maxCameras} cameras can be on at once.`);
    }
    const res = await this.realtime.tracksNew(mine.sessionId, {
      sessionDescription: body.sessionDescription,
      tracks: body.tracks.map((t) => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
    });
    const updated = await this.mutate(conversationId, (c) => {
      if (!c) return null;
      return {
        ...c,
        participants: c.participants.map((p) =>
          p.userId === me ? { ...p, tracks: [...p.tracks.filter((t) => !body.tracks.some((n) => n.trackName === t.trackName)), ...body.tracks.map((t) => ({ trackName: t.trackName, kind: t.kind }))] } : p,
        ),
      };
    });
    if (updated) await this.broadcast(conversationId, participants, updated);
    return res;
  }

  /** Receive other people's tracks — only tracks that are really in this call. */
  async pull(me: string, conversationId: string, tracks: { sessionId: string; trackName: string }[]): Promise<RealtimeTracksResponse> {
    await this.dm.callAccess(me, conversationId);
    const call = await this.tidy(conversationId);
    const mine = call?.participants.find((p) => p.userId === me);
    if (!call || !mine) throw new NotFoundException("You're not in this call.");
    for (const t of tracks) {
      const owner = call.participants.find((p) => p.sessionId === t.sessionId);
      if (!owner || owner.userId === me || !owner.tracks.some((x) => x.trackName === t.trackName)) throw new BadRequestException('That track is not in this call.');
    }
    return this.realtime.tracksNew(mine.sessionId, { tracks: tracks.map((t) => ({ location: 'remote', sessionId: t.sessionId, trackName: t.trackName })) });
  }

  async renegotiate(me: string, conversationId: string, sessionDescription: SessionDescription): Promise<RealtimeTracksResponse> {
    const mine = await this.myParticipant(me, conversationId);
    return this.realtime.renegotiate(mine.sessionId, { sessionDescription });
  }

  /** Stop sending some of my tracks (camera off, screen share ended). */
  async close(
    me: string,
    conversationId: string,
    body: { mids: string[]; trackNames: string[]; sessionDescription?: SessionDescription },
  ): Promise<RealtimeTracksResponse> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const mine = await this.myParticipant(me, conversationId);
    const res = await this.realtime.tracksClose(mine.sessionId, {
      tracks: body.mids.map((mid) => ({ mid })),
      ...(body.sessionDescription ? { sessionDescription: body.sessionDescription } : {}),
      force: !body.sessionDescription,
    });
    const updated = await this.mutate(conversationId, (c) =>
      c ? { ...c, participants: c.participants.map((p) => (p.userId === me ? { ...p, tracks: p.tracks.filter((t) => !body.trackNames.includes(t.trackName)) } : p)) } : null,
    );
    if (updated) await this.broadcast(conversationId, participants, updated);
    return res;
  }

  async mute(me: string, conversationId: string, muted: boolean): Promise<void> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const updated = await this.mutate(conversationId, (c) => (c ? { ...c, participants: c.participants.map((p) => (p.userId === me ? { ...p, muted } : p)) } : null));
    if (updated) await this.broadcast(conversationId, participants, updated);
  }

  /** "Still here" — also counts this person's traffic for the monthly meter. */
  async heartbeat(me: string, conversationId: string): Promise<CallState | null> {
    await this.dm.callAccess(me, conversationId);
    const call = await this.tidy(conversationId);
    if (!call || !call.participants.some((p) => p.userId === me)) return call ? toState(call) : null;
    await this.seen(conversationId, me);
    await this.meter(downloadBytes(call, me, CALL_LIMITS.heartbeatMs / 1000));
    return toState(call);
  }

  async leave(me: string, conversationId: string): Promise<void> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const call = await this.mutate(conversationId, (c) => (c ? { ...c, participants: c.participants.filter((p) => p.userId !== me), ringing: c.ringing.filter((u) => u !== me) } : null));
    await this.redis.hdel(this.seenKey(conversationId), me).catch(() => 0);
    if (call) await this.endIfEmpty(conversationId, participants, call);
  }

  async decline(me: string, conversationId: string): Promise<void> {
    const { participants } = await this.dm.callAccess(me, conversationId);
    const call = await this.mutate(conversationId, (c) => (c ? { ...c, ringing: c.ringing.filter((u) => u !== me) } : null));
    if (!call) return;
    // A 1:1 call nobody else will answer ends right away.
    if (call.ringing.length === 0 && call.participants.every((p) => p.userId === call.startedBy)) {
      await this.end(conversationId, participants, call);
    } else {
      await this.broadcast(conversationId, participants, call);
    }
  }

  // --- internals ---------------------------------------------------------------------------

  private key(conversationId: string): string {
    return `kamby:call:${conversationId}`;
  }

  private seenKey(conversationId: string): string {
    return `kamby:call:${conversationId}:seen`;
  }

  private async read(conversationId: string): Promise<CallRecord | null> {
    const raw = await this.redis.get(this.key(conversationId));
    return raw ? (JSON.parse(raw) as CallRecord) : null;
  }

  /** Read-modify-write under a short per-call lock (several people join at once). */
  private async mutate(conversationId: string, fn: (call: CallRecord | null) => CallRecord | null): Promise<CallRecord | null> {
    const lock = `${this.key(conversationId)}:lock`;
    for (let i = 0; i < 40; i++) {
      if ((await this.redis.set(lock, '1', 'PX', 3000, 'NX')) === 'OK') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      const next = fn(await this.read(conversationId));
      if (next) await this.redis.set(this.key(conversationId), JSON.stringify(next), 'EX', 6 * 3600);
      else await this.redis.del(this.key(conversationId));
      return next;
    } finally {
      await this.redis.del(lock);
    }
  }

  private async seen(conversationId: string, userId: string): Promise<void> {
    await this.redis.hset(this.seenKey(conversationId), userId, String(Date.now())).catch(() => 0);
    await this.redis.expire(this.seenKey(conversationId), 6 * 3600).catch(() => 0);
  }

  /** Drop people who stopped checking in, stop ringing after a while, end empty calls. */
  private async tidy(conversationId: string): Promise<CallRecord | null> {
    const call = await this.read(conversationId);
    if (!call) return null;
    const seen = await this.redis.hgetall(this.seenKey(conversationId)).catch(() => ({}) as Record<string, string>);
    const now = Date.now();
    const alive = call.participants.filter((p) => {
      const last = Number(seen[p.userId] ?? Date.parse(p.joinedAt));
      return now - last < CALL_LIMITS.staleMs;
    });
    const ringingOver = now - Date.parse(call.startedAt) > CALL_LIMITS.ringSeconds * 1000;
    if (alive.length === call.participants.length && !(ringingOver && call.ringing.length > 0)) return call;
    const { participants } = await this.dm.callAccess(call.startedBy, conversationId).catch(() => ({ participants: [] as string[] }));
    const next = await this.mutate(conversationId, (c) =>
      c ? { ...c, participants: c.participants.filter((p) => alive.some((a) => a.userId === p.userId)), ringing: ringingOver ? [] : c.ringing } : null,
    );
    if (!next) return null;
    return (await this.endIfEmpty(conversationId, participants, next)) ? null : next;
  }

  /** Ends the call if nobody's in it (or only the caller, with nobody left to ring). */
  private async endIfEmpty(conversationId: string, participants: string[], call: CallRecord): Promise<boolean> {
    const onlyCaller = call.participants.length === 1 && call.participants[0]!.userId === call.startedBy && call.ringing.length === 0 && !call.answered;
    // A 1:1 call is over as soon as one side hangs up.
    const pairHungUp = participants.length <= 2 && call.answered && call.participants.length < 2;
    if (call.participants.length === 0 || (!call.lounge && (onlyCaller || pairHungUp))) {
      await this.end(conversationId, participants, call);
      return true;
    }
    await this.broadcast(conversationId, participants, call);
    return false;
  }

  private async end(conversationId: string, participants: string[], call: CallRecord): Promise<void> {
    await this.redis.del(this.key(conversationId), this.seenKey(conversationId));
    if (call.lounge) {
      // Lounges come and go all day — no "Call · 12 min" lines in the channels.
      await this.dm.publishEvent({ type: 'call', userIds: participants, conversationId, call: null });
      return;
    }
    const caller = await prisma.user.findUnique({ where: { id: call.startedBy }, select: { username: true } });
    const durationSec = call.answered ? Math.max(1, Math.round((Date.now() - Date.parse(call.startedAt)) / 1000)) : 0;
    await this.dm.postSystem(conversationId, { event: 'call', actor: caller?.username ?? null, targets: [], durationSec, video: call.video }).catch(() => undefined);
    await this.dm.publishEvent({ type: 'call', userIds: participants, conversationId, call: null });
  }

  private async broadcast(conversationId: string, participants: string[], call: CallRecord): Promise<void> {
    await this.dm.publishEvent({ type: 'call', userIds: participants, conversationId, call: toState(call) });
  }

  private async myParticipant(me: string, conversationId: string): Promise<CallParticipant> {
    await this.dm.callAccess(me, conversationId);
    const call = await this.read(conversationId);
    const mine = call?.participants.find((p) => p.userId === me);
    if (!mine) throw new NotFoundException("You're not in this call.");
    return mine;
  }

  /** Monthly SFU traffic (an estimate from what's being pulled). The owner is told at
   *  800 GB and 1,000 GB (Cloudflare's free allowance) — calls never stop (owner's call). */
  private async meter(bytes: number): Promise<void> {
    if (bytes <= 0) return;
    const month = new Date().toISOString().slice(0, 7);
    const key = `kamby:calls:egress:${month}`;
    const total = await this.redis.incrby(key, bytes).catch(() => 0);
    await this.redis.expire(key, 40 * 86400).catch(() => 0);
    for (const gb of CALL_LIMITS.alertGb) {
      if (total >= gb * 1e9 && (await this.redis.set(`${key}:alert:${gb}`, '1', 'EX', 40 * 86400, 'NX').catch(() => null)) === 'OK') {
        this.logger.error({ gb, month }, `Calls traffic passed ${gb} GB this month (Cloudflare Realtime: 1,000 GB free, then ~$0.05/GB)`);
      }
    }
  }
}
