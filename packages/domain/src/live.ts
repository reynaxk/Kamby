/**
 * Live rooms (2026-10-17, owner: "Live room like Twitch / Spaces"): a trader goes live with their
 * voice and their screen (the terminal, a chart), anyone signed in can watch and chat. Version 1
 * is voice + screen only — no camera: a live room is public to strangers and can't be moderated
 * as it happens. Three reports from different viewers end the room. Built on the same
 * Cloudflare Realtime SFU as calls (the host publishes, viewers only pull).
 */

export const LIVE_LIMITS = {
  titleMax: 60,
  chatMax: 200,
  chatCooldownMs: 1500,
  chatKeep: 80,
  reportsToEnd: 3,
  heartbeatMs: 15_000,
  /** A host silent this long has dropped — the room ends. */
  hostStaleMs: 45_000,
  viewerStaleMs: 45_000,
} as const;

export type LiveTrackKind = 'audio' | 'screen';

export interface LiveHost {
  userId: string;
  username: string;
  avatarUrl: string | null;
  walletAddress: string | null;
}

export interface LiveRoom {
  id: string;
  title: string;
  host: LiveHost;
  /** The coin it's about, if any. */
  coin: { chainIdentifier: string; tokenAddress: string; symbol: string | null; logoUrl: string | null } | null;
  startedAt: string;
  viewers: number;
  /** The host's Cloudflare session + what they're sending — viewers pull these. */
  hostSessionId: string | null;
  tracks: { trackName: string; kind: LiveTrackKind }[];
  muted: boolean;
}

export interface LiveChatLine {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  body: string;
  at: string;
  host: boolean;
}

export const LIVE_REALTIME_CHANNEL = 'kamby:live';
export type LiveEvent =
  | { type: 'room'; roomId: string; room: LiveRoom }
  | { type: 'chat'; roomId: string; line: LiveChatLine }
  | { type: 'ended'; roomId: string };
