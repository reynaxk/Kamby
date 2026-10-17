'use client';

import { LIVE_LIMITS, type LiveChatLine, type LiveRoom, type LiveTrackKind } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk } from './session-client';

/** Live rooms (2026-10-17) — browser side: the API wrappers and the host / viewer engines. */

interface Sdp {
  type: 'offer' | 'answer';
  sdp: string;
}
interface TracksResponse {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: Sdp;
  tracks?: { mid?: string; trackName?: string; errorCode?: string }[];
}
interface JoinResponse {
  room: LiveRoom;
  sessionId: string;
  iceServers: RTCIceServer[];
}

async function post<T>(path: string, body?: unknown, what = 'update the live'): Promise<T> {
  const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  await expectOk(res, what);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function fetchLiveRooms(): Promise<LiveRoom[]> {
  const res = await fetch(`${API_BASE}/v1/live`);
  return res.ok ? ((await res.json()) as LiveRoom[]) : [];
}
export async function fetchLiveRoom(id: string): Promise<LiveRoom | null> {
  const res = await fetch(`${API_BASE}/v1/live/${id}`);
  return res.ok ? ((await res.json()) as LiveRoom) : null;
}
export async function fetchLiveChat(id: string): Promise<LiveChatLine[]> {
  const res = await fetch(`${API_BASE}/v1/live/${id}/chat`);
  return res.ok ? ((await res.json()) as LiveChatLine[]) : [];
}
export const liveStreamUrl = (id: string) => `${API_BASE}/v1/live/${id}/stream`;
export const startLive = (title: string, tokenKey?: string) => post<JoinResponse>('/live', { title, ...(tokenKey ? { tokenKey } : {}) }, 'go live');
export const sayInLive = (id: string, body: string) => post<LiveChatLine>(`/live/${id}/chat`, { body }, 'send');
export const pinLiveTrade = (id: string, coin: { chain: string; tokenAddress: string } | null) => post<LiveRoom>(`/live/${id}/trade`, coin ?? {}, 'pin the trade');
export const reportLive = (id: string) => post<{ ended: boolean }>(`/live/${id}/report`, undefined, 'report');

type Queue = { run: (job: () => Promise<void>) => Promise<void> };
function queue(): Queue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(job) {
      const next = tail.then(job);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

/** The host: sends the mic (and the screen when shared). */
export class LiveHostEngine {
  private readonly pc: RTCPeerConnection;
  private readonly q = queue();
  private readonly local = new Map<LiveTrackKind, { track: MediaStreamTrack; transceiver: RTCRtpTransceiver; trackName: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  muted = false;
  room: LiveRoom;
  onChange: () => void = () => undefined;
  onEnded: () => void = () => undefined;

  private constructor(
    readonly id: string,
    private readonly me: string,
    join: JoinResponse,
  ) {
    this.room = join.room;
    this.pc = new RTCPeerConnection({ iceServers: join.iceServers, bundlePolicy: 'max-bundle' });
  }

  static async begin(join: JoinResponse, me: string): Promise<LiveHostEngine> {
    const engine = new LiveHostEngine(join.room.id, me, join);
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    await engine.publish('audio', mic.getAudioTracks()[0]!);
    engine.timer = setInterval(() => {
      post<LiveRoom | null>(`/live/${engine.id}/heartbeat`)
        .then((r) => {
          if (!r) return engine.end();
          engine.room = r;
          engine.onChange();
        })
        .catch(() => undefined);
    }, LIVE_LIMITS.heartbeatMs);
    return engine;
  }

  get canShareScreen(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
  }
  screenTrack(): MediaStreamTrack | null {
    return this.local.get('screen')?.track ?? null;
  }

  async setScreen(on: boolean): Promise<void> {
    if (on === this.local.has('screen')) return;
    if (!on) return this.unpublish('screen');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15 } }, audio: false });
    const track = stream.getVideoTracks()[0]!;
    track.contentHint = 'detail';
    track.addEventListener('ended', () => void this.setScreen(false));
    await this.publish('screen', track);
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    const a = this.local.get('audio');
    if (a) a.track.enabled = !muted;
    this.onChange();
    await post(`/live/${this.id}/mute`, { muted }).catch(() => undefined);
  }

  async stop(): Promise<void> {
    await post(`/live/${this.id}/stop`).catch(() => undefined);
    this.end();
  }

  end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const l of this.local.values()) l.track.stop();
    this.local.clear();
    this.pc.close();
    this.onEnded();
  }

  private publish(kind: LiveTrackKind, track: MediaStreamTrack): Promise<void> {
    return this.q.run(async () => {
      const transceiver = this.pc.addTransceiver(track, { direction: 'sendonly' });
      const trackName = `${this.me}:${kind}:${Math.random().toString(36).slice(2, 10)}`;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await post<TracksResponse>(`/live/${this.id}/publish`, { sessionDescription: { type: 'offer', sdp: offer.sdp }, tracks: [{ mid: transceiver.mid, trackName, kind }] });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      this.local.set(kind, { track, transceiver, trackName });
      this.onChange();
    });
  }

  private unpublish(kind: LiveTrackKind): Promise<void> {
    return this.q.run(async () => {
      const l = this.local.get(kind);
      if (!l) return;
      this.local.delete(kind);
      l.track.stop();
      const mid = l.transceiver.mid ?? '';
      l.transceiver.direction = 'inactive';
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await post<TracksResponse>(`/live/${this.id}/close`, { mids: [mid], trackNames: [l.trackName], sessionDescription: { type: 'offer', sdp: offer.sdp } }).catch(() => null);
      if (res?.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription).catch(() => undefined);
      this.onChange();
    });
  }
}

/** A viewer: receives the host's voice and screen, nothing sent. */
export class LiveViewerEngine {
  private readonly pc: RTCPeerConnection;
  private readonly q = queue();
  private readonly pulled = new Map<string, { mid: string; kind: LiveTrackKind }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  room: LiveRoom;
  onChange: () => void = () => undefined;
  onEnded: () => void = () => undefined;

  private constructor(readonly id: string, join: JoinResponse) {
    this.room = join.room;
    this.pc = new RTCPeerConnection({ iceServers: join.iceServers, bundlePolicy: 'max-bundle' });
  }

  static async watch(id: string): Promise<LiveViewerEngine> {
    const join = await post<JoinResponse>(`/live/${id}/watch`, undefined, 'watch');
    const engine = new LiveViewerEngine(id, join);
    await engine.sync(join.room);
    engine.timer = setInterval(() => {
      post<LiveRoom | null>(`/live/${id}/heartbeat`)
        .then((r) => (r ? void engine.sync(r) : engine.end()))
        .catch(() => undefined);
    }, LIVE_LIMITS.heartbeatMs);
    return engine;
  }

  track(kind: LiveTrackKind): MediaStreamTrack | null {
    const byMid = new Map(this.pc.getTransceivers().map((t) => [t.mid, t.receiver.track]));
    for (const t of this.room.tracks) {
      const p = this.pulled.get(t.trackName);
      if (p && p.kind === kind) return byMid.get(p.mid) ?? null;
    }
    return null;
  }

  sync(room: LiveRoom): Promise<void> {
    this.room = room;
    for (const name of [...this.pulled.keys()]) if (!room.tracks.some((t) => t.trackName === name)) this.pulled.delete(name);
    const fresh = room.tracks.filter((t) => !this.pulled.has(t.trackName));
    this.onChange();
    if (fresh.length === 0) return Promise.resolve();
    return this.q.run(async () => {
      const res = await post<TracksResponse>(`/live/${this.id}/pull`, { trackNames: fresh.map((f) => f.trackName) });
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await post(`/live/${this.id}/renegotiate`, { sessionDescription: { type: 'answer', sdp: answer.sdp } });
      }
      for (const t of res.tracks ?? []) {
        const f = fresh.find((x) => x.trackName === t.trackName);
        if (f && t.mid && !t.errorCode) this.pulled.set(f.trackName, { mid: t.mid, kind: f.kind });
      }
      this.onChange();
    });
  }

  async leave(): Promise<void> {
    await post(`/live/${this.id}/leave`).catch(() => undefined);
    this.end();
  }

  end(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pc.close();
    this.onEnded();
  }
}
