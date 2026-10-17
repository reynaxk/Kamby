'use client';

import { CALL_LIMITS, callTrackName, type CallJoin, type CallState, type CallTrackKind } from '@kamby/domain';
import { callHeartbeat, closeTracks, leaveCall, publishTracks, pullTracks, renegotiateCall, setCallMuted } from './calls-client';

export interface RemoteMedia {
  userId: string;
  muted: boolean;
  audio: MediaStreamTrack | null;
  video: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
}

interface LocalTrack {
  track: MediaStreamTrack;
  transceiver: RTCRtpTransceiver;
  trackName: string;
}

/**
 * One person's side of a call (2026-10-17): a single RTCPeerConnection to Cloudflare Realtime
 * (everything bundled), sending this person's mic / camera / screen and receiving everyone
 * else's. Every offer/answer goes through the API (which checks it) — negotiations run one at a
 * time on a queue so two changes never race. Remote tracks are read from the transceivers by
 * their mid, so nothing depends on `ontrack` timing.
 */
export class CallEngine {
  readonly conversationId: string;
  readonly me: string;
  readonly sessionId: string;
  private readonly pc: RTCPeerConnection;
  private readonly local = new Map<CallTrackKind, LocalTrack>();
  /** trackName → its receive mid, for tracks pulled from other people. */
  private readonly pulled = new Map<string, { mid: string; userId: string; kind: CallTrackKind }>();
  private queue: Promise<unknown> = Promise.resolve();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  call: CallState;
  muted = false;
  facing: 'user' | 'environment' = 'user';
  onChange: () => void = () => undefined;
  onEnded: () => void = () => undefined;

  private constructor(conversationId: string, me: string, join: CallJoin) {
    this.conversationId = conversationId;
    this.me = me;
    this.sessionId = join.sessionId;
    this.call = join.call;
    this.pc = new RTCPeerConnection({ iceServers: join.iceServers as RTCIceServer[], bundlePolicy: 'max-bundle' });
    this.pc.onconnectionstatechange = () => this.onChange();
  }

  /** Joins with the mic on (and the camera, for a video call). */
  static async connect(conversationId: string, me: string, join: CallJoin, withVideo: boolean): Promise<CallEngine> {
    const engine = new CallEngine(conversationId, me, join);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    await engine.publish('audio', stream.getAudioTracks()[0]!);
    if (withVideo) await engine.setCamera(true).catch(() => undefined);
    await engine.sync(join.call);
    engine.heartbeatTimer = setInterval(() => {
      callHeartbeat(conversationId)
        .then((c) => (c ? void engine.sync(c) : engine.end()))
        .catch(() => undefined);
    }, CALL_LIMITS.heartbeatMs);
    return engine;
  }

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  localTrack(kind: CallTrackKind): MediaStreamTrack | null {
    return this.local.get(kind)?.track ?? null;
  }

  /** Everyone else in the call, with whatever of their tracks have arrived. */
  remotes(): RemoteMedia[] {
    const byMid = new Map(this.pc.getTransceivers().map((t) => [t.mid, t.receiver.track]));
    return this.call.participants
      .filter((p) => p.userId !== this.me)
      .map((p) => {
        const media: RemoteMedia = { userId: p.userId, muted: p.muted, audio: null, video: null, screen: null };
        for (const t of p.tracks) {
          const pulled = this.pulled.get(t.trackName);
          const track = pulled ? (byMid.get(pulled.mid) ?? null) : null;
          if (track) media[t.kind] = track;
        }
        return media;
      });
  }

  /** Bring the call up to date: pull new tracks, forget ones that are gone. */
  sync(call: CallState): Promise<void> {
    this.call = call;
    if (!call.participants.some((p) => p.userId === this.me)) {
      this.end();
      return Promise.resolve();
    }
    const wanted = call.participants.filter((p) => p.userId !== this.me).flatMap((p) => p.tracks.map((t) => ({ ...t, sessionId: p.sessionId, userId: p.userId })));
    const gone = [...this.pulled.keys()].filter((name) => !wanted.some((w) => w.trackName === name));
    for (const name of gone) this.pulled.delete(name);
    const fresh = wanted.filter((w) => !this.pulled.has(w.trackName));
    this.onChange();
    if (fresh.length === 0) return Promise.resolve();
    return this.enqueue(async () => {
      const res = await pullTracks(this.conversationId, fresh.map((f) => ({ sessionId: f.sessionId, trackName: f.trackName })));
      if (res.requiresImmediateRenegotiation && res.sessionDescription) {
        await this.pc.setRemoteDescription(res.sessionDescription);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await renegotiateCall(this.conversationId, { type: 'answer', sdp: answer.sdp ?? '' });
      }
      for (const t of res.tracks ?? []) {
        const f = fresh.find((x) => x.trackName === t.trackName);
        if (f && t.mid && !t.errorCode) this.pulled.set(f.trackName, { mid: t.mid, userId: f.userId, kind: f.kind });
      }
      this.onChange();
    });
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    const audio = this.local.get('audio');
    if (audio) audio.track.enabled = !muted;
    this.onChange();
    await setCallMuted(this.conversationId, muted).catch(() => undefined);
  }

  async setCamera(on: boolean): Promise<void> {
    if (on === this.local.has('video')) return;
    if (!on) return this.unpublish('video');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } } });
    await this.publish('video', stream.getVideoTracks()[0]!);
  }

  /** Front / back camera — swaps the track in place, no renegotiation. */
  async flipCamera(): Promise<void> {
    const video = this.local.get('video');
    if (!video) return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: this.facing, width: { ideal: 640 }, height: { ideal: 480 } } });
    const next = stream.getVideoTracks()[0]!;
    await video.transceiver.sender.replaceTrack(next);
    video.track.stop();
    video.track = next;
    this.onChange();
  }

  get canShareScreen(): boolean {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices && 'getDisplayMedia' in navigator.mediaDevices);
  }

  async setScreen(on: boolean): Promise<void> {
    if (on === this.local.has('screen')) return;
    if (!on) return this.unpublish('screen');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 12 } }, audio: false });
    const track = stream.getVideoTracks()[0]!;
    track.contentHint = 'detail';
    track.addEventListener('ended', () => void this.setScreen(false));
    await this.publish('screen', track);
  }

  /** Hang up (also stops the mic / camera). */
  async leave(): Promise<void> {
    if (this.closed) return;
    await leaveCall(this.conversationId).catch(() => undefined);
    this.end();
  }

  /** Local teardown (the call ended or we were dropped). */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const l of this.local.values()) l.track.stop();
    this.local.clear();
    this.pc.close();
    this.onEnded();
  }

  private publish(kind: CallTrackKind, track: MediaStreamTrack): Promise<void> {
    return this.enqueue(async () => {
      const transceiver = this.pc.addTransceiver(track, { direction: 'sendonly' });
      const trackName = callTrackName(this.me, kind);
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await publishTracks(this.conversationId, { type: 'offer', sdp: offer.sdp ?? '' }, [{ mid: transceiver.mid ?? '', trackName, kind }]).catch((error: unknown) => {
        track.stop();
        transceiver.stop();
        throw error;
      });
      if (res.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription);
      this.local.set(kind, { track, transceiver, trackName });
      this.onChange();
    });
  }

  private unpublish(kind: CallTrackKind): Promise<void> {
    return this.enqueue(async () => {
      const l = this.local.get(kind);
      if (!l) return;
      this.local.delete(kind);
      l.track.stop();
      const mid = l.transceiver.mid ?? '';
      l.transceiver.direction = 'inactive';
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const res = await closeTracks(this.conversationId, [mid], [l.trackName], { type: 'offer', sdp: offer.sdp ?? '' }).catch(() => null);
      if (res?.sessionDescription) await this.pc.setRemoteDescription(res.sessionDescription).catch(() => undefined);
      this.onChange();
    });
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.queue.then(() => (this.closed ? undefined : job()));
    this.queue = next.catch(() => undefined);
    return next;
  }
}
