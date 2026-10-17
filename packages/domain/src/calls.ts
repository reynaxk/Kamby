/**
 * Voice / video / screen-share calls in private chats and groups (2026-10-17), on Cloudflare
 * Realtime (an SFU — everyone sends their tracks once and pulls the others'). Owner's rules:
 * only in accepted chats, camera off by default, Report inside the call, no recording, at most
 * 8 cameras on at once in a group (the rest are voice), up to 32 people in a call.
 */

export const CALL_LIMITS = {
  maxParticipants: 32,
  maxCameras: 8,
  /** How long a new call rings before it counts as missed. */
  ringSeconds: 45,
  /** Each person in a call checks in this often; someone silent for staleMs has dropped. */
  heartbeatMs: 15_000,
  staleMs: 45_000,
  /** Traffic the owner is told about (GB of SFU egress per month). */
  alertGb: [800, 1000] as const,
} as const;

export type CallTrackKind = 'audio' | 'video' | 'screen';

export interface CallTrack {
  trackName: string;
  kind: CallTrackKind;
}

export interface CallParticipant {
  userId: string;
  /** Their Cloudflare Realtime session — other people pull this person's tracks from it. */
  sessionId: string;
  joinedAt: string;
  tracks: CallTrack[];
  muted: boolean;
}

export interface CallState {
  id: string;
  conversationId: string;
  startedBy: string;
  startedAt: string;
  /** Started as a video call (the caller's camera is on). */
  video: boolean;
  participants: CallParticipant[];
  /** People still being rung (not joined, not declined). */
  ringing: string[];
  /** A community's voice lounge: nobody is rung, people drop in and out, it stays open while
   *  anyone's in it (2026-10-17). */
  lounge?: boolean;
}

export interface CallJoin {
  call: CallState;
  sessionId: string;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

/** A track name says whose it is and what it is — the server checks the prefix is yours. */
export function callTrackName(userId: string, kind: CallTrackKind): string {
  return `${userId}:${kind}:${Math.random().toString(36).slice(2, 10)}`;
}
