'use client';

import { LIVE_LIMITS, type LiveChatLine, type LiveRoom, type LiveTipChain, type LiveTipQuote, type LiveTrackKind } from '@kamby/domain';
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

/** Host moderation (2026-10-30). */
export const removeLiveLine = (id: string, lineId: string) => post<void>(`/live/${id}/chat/${lineId}/remove`, undefined, 'remove the message');
export const silenceInLive = (id: string, userId: string) => post<void>(`/live/${id}/silence`, { userId }, 'silence them');

/** Tips (2026-10-30): prepare → sign in the wallet → submit (see LiveTipSheet). */
export const prepareLiveTip = (id: string, chain: LiveTipChain, amountUsd: number) => post<LiveTipQuote>(`/live/${id}/tips`, { chain, amountUsd }, 'prepare the tip');
export const submitLiveTip = (id: string, tipId: string, proof: { signedTransactionBase64?: string; txHashes?: string[] }) =>
  post<{ ok: true; amountUsd: number }>(`/live/${id}/tips/${tipId}`, proof, 'send the tip');

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
/** The stream's card picture (2026-10-30) — a small frame of the stage; the server moderates it. */
export async function uploadLiveThumb(id: string, video: HTMLVideoElement): Promise<void> {
  if (!video.videoWidth) return;
  const scale = Math.min(1, 480 / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.72));
  if (!blob) return;
  const form = new FormData();
  form.set('file', blob, 'thumb.jpg');
  await authedFetch(`/live/${id}/thumb`, { method: 'POST', body: form }).catch(() => undefined);
}
export const liveThumbUrl = (id: string) => `${API_BASE}/v1/live/${id}/thumb?m=${Math.floor(Date.now() / 120_000)}`;
export const reportLive = (id: string) => post<{ ended: boolean }>(`/live/${id}/report`, undefined, 'report');

/** How the call is doing — drives the "Reconnecting…" / "Weak connection" badges (2026-10-30). */
export type LiveConnection = 'connecting' | 'connected' | 'reconnecting' | 'failed';

/** Sending quality per kind (2026-10-30): the screen keeps its sharpness (charts and numbers must
 *  stay readable) and drops frames first; the camera keeps moving and drops resolution first. */
const SEND: Record<LiveTrackKind, { maxBitrate: number; maxFramerate?: number; degradation?: RTCDegradationPreference }> = {
  audio: { maxBitrate: 64_000 },
  screen: { maxBitrate: 2_500_000, maxFramerate: 15, degradation: 'maintain-resolution' },
  camera: { maxBitrate: 900_000, maxFramerate: 24, degradation: 'maintain-framerate' },
};

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

/** The host: sends the mic (and the screen and camera when on). */
export class LiveHostEngine {
  private readonly pc: RTCPeerConnection;
  private readonly q = queue();
  private readonly local = new Map<LiveTrackKind, { track: MediaStreamTrack; transceiver: RTCRtpTransceiver; trackName: string }>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private restarting = false;
  muted = false;
  connection: LiveConnection = 'connecting';
  /** True while the browser is cutting quality for a slow network or a busy CPU. */
  weak = false;
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
    this.pc.addEventListener('connectionstatechange', () => this.onState());
  }

  /** A dropped network (Wi-Fi → 4G): one ICE restart, then "failed" if it doesn't come back. */
  private onState(): void {
    const st = this.pc.connectionState;
    if (st === 'connected') this.connection = 'connected';
    else if (st === 'disconnected') this.connection = 'reconnecting';
    else if (st === 'failed') {
      this.connection = 'reconnecting';
      if (!this.restarting) void this.iceRestart();
    }
    this.onChange();
  }

  private iceRestart(): Promise<void> {
    this.restarting = true;
    return this.q.run(async () => {
      try {
        const offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        const res = await post<TracksResponse>(`/live/${this.id}/host-renegotiate`, { sessionDescription: { type: 'offer', sdp: offer.sdp } });
        if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      } catch {
        this.connection = 'failed';
        this.onChange();
      } finally {
        setTimeout(() => (this.restarting = false), 10_000);
      }
    });
  }

  /** Every 5 s: is the browser holding quality back? (bandwidth / cpu limitation, or no bytes moving) */
  private async readStats(): Promise<void> {
    const stats = await this.pc.getStats().catch(() => null);
    if (!stats) return;
    let bytes = 0;
    let limited = false;
    stats.forEach((r: RTCStats & { kind?: string; bytesSent?: number; qualityLimitationReason?: string }) => {
      if (r.type !== 'outbound-rtp') return;
      bytes += r.bytesSent ?? 0;
      if (r.kind === 'video' && r.qualityLimitationReason && r.qualityLimitationReason !== 'none') limited = true;
    });
    const moving = bytes > this.lastBytes;
    this.lastBytes = bytes;
    const weak = limited || (!moving && this.connection === 'connected');
    if (weak !== this.weak) {
      this.weak = weak;
      this.onChange();
    }
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
    engine.statsTimer = setInterval(() => void engine.readStats(), 5_000);
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

  get canUseCamera(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  }
  cameraTrack(): MediaStreamTrack | null {
    return this.local.get('camera')?.track ?? null;
  }

  /** The host's face (2026-10-30) — a small picture over the screen, or the whole stage without one. */
  async setCamera(on: boolean): Promise<void> {
    if (on === this.local.has('camera')) return;
    if (!on) return this.unpublish('camera');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 24 }, facingMode: 'user' }, audio: false });
    const track = stream.getVideoTracks()[0]!;
    track.contentHint = 'motion';
    track.addEventListener('ended', () => void this.setCamera(false));
    await this.publish('camera', track);
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
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.timer = null;
    this.statsTimer = null;
    for (const l of this.local.values()) l.track.stop();
    this.local.clear();
    this.pc.close();
    this.onEnded();
  }

  private publish(kind: LiveTrackKind, track: MediaStreamTrack): Promise<void> {
    return this.q.run(async () => {
      const q = SEND[kind];
      const transceiver = this.pc.addTransceiver(track, { direction: 'sendonly', sendEncodings: [{ maxBitrate: q.maxBitrate, ...(q.maxFramerate ? { maxFramerate: q.maxFramerate } : {}) }] });
      if (q.degradation) {
        const params = transceiver.sender.getParameters();
        params.degradationPreference = q.degradation;
        await transceiver.sender.setParameters(params).catch(() => undefined);
      }
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
  private dropTimer: ReturnType<typeof setTimeout> | null = null;
  room: LiveRoom;
  connection: LiveConnection = 'connecting';
  onChange: () => void = () => undefined;
  onEnded: () => void = () => undefined;
  /** The call is gone (network dropped for good) — the room screen starts a fresh one. */
  onFailed: () => void = () => undefined;

  private constructor(readonly id: string, join: JoinResponse) {
    this.room = join.room;
    this.pc = new RTCPeerConnection({ iceServers: join.iceServers, bundlePolicy: 'max-bundle' });
    this.pc.addEventListener('connectionstatechange', () => {
      const st = this.pc.connectionState;
      if (this.dropTimer) clearTimeout(this.dropTimer);
      this.dropTimer = null;
      if (st === 'connected') this.connection = 'connected';
      else if (st === 'disconnected') {
        this.connection = 'reconnecting';
        // A short blip recovers by itself; 6 s without it means rejoin.
        this.dropTimer = setTimeout(() => this.onFailed(), 6_000);
      } else if (st === 'failed') {
        this.connection = 'reconnecting';
        this.onFailed();
      }
      this.onChange();
    });
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
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.timer = null;
    this.dropTimer = null;
    this.pc.close();
    this.onEnded();
  }
}
