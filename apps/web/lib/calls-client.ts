'use client';

import type { CallJoin, CallState, CallTrackKind } from '@kamby/domain';
import { authedFetch, expectOk } from './session-client';

/** Browser client for calls (2026-10-17) — see apps/api/src/calls. `id` is the conversation. */

export interface Sdp {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface TracksResponse {
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: Sdp;
  tracks?: { mid?: string; trackName?: string; sessionId?: string; errorCode?: string }[];
}

async function post<T>(path: string, body?: unknown, what = 'update the call'): Promise<T> {
  const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  await expectOk(res, what);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function fetchCall(id: string): Promise<CallState | null> {
  const res = await authedFetch(`/calls/${id}`);
  await expectOk(res, 'load the call');
  const text = await res.text();
  return text ? (JSON.parse(text) as CallState | null) : null;
}
export const startCall = (id: string, video: boolean) => post<CallJoin>(`/calls/${id}/start`, { video }, 'start the call');
export const joinCall = (id: string) => post<CallJoin>(`/calls/${id}/join`, undefined, 'join the call');
export const publishTracks = (id: string, sessionDescription: Sdp, tracks: { mid: string; trackName: string; kind: CallTrackKind }[]) =>
  post<TracksResponse>(`/calls/${id}/publish`, { sessionDescription, tracks });
export const pullTracks = (id: string, tracks: { sessionId: string; trackName: string }[]) => post<TracksResponse>(`/calls/${id}/pull`, { tracks });
export const renegotiateCall = (id: string, sessionDescription: Sdp) => post<TracksResponse>(`/calls/${id}/renegotiate`, { sessionDescription });
export const closeTracks = (id: string, mids: string[], trackNames: string[], sessionDescription?: Sdp) =>
  post<TracksResponse>(`/calls/${id}/close`, { mids, trackNames, ...(sessionDescription ? { sessionDescription } : {}) });
export const setCallMuted = (id: string, muted: boolean) => post<null>(`/calls/${id}/mute`, { muted });
export const callHeartbeat = (id: string) => post<CallState | null>(`/calls/${id}/heartbeat`);
export const leaveCall = (id: string) => post<null>(`/calls/${id}/leave`);
export const declineCall = (id: string) => post<null>(`/calls/${id}/decline`);
