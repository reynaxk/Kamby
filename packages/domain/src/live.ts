import type { DmTrade } from './dm';
/**
 * Live rooms (2026-10-17, owner: "Live room like Twitch / Spaces"): a trader goes live with their
 * voice and their screen (the terminal, a chart), anyone signed in can watch and chat. Version 1
 * is voice + screen only — no camera: a live room is public to strangers and can't be moderated
 * as it happens. Three reports from different viewers end the room. Built on the same
 * Cloudflare Realtime SFU as calls (the host publishes, viewers only pull).
 *
 * 2026-10-30 (owner: "Live Trading Streams — crypto Twitch"): the host can add their camera, and
 * the room gets Twitch tools — the host removes chat lines and silences people, Kamby trades made
 * by the host or anyone watching appear in chat as alerts, viewers can tip the host in USDC
 * ($5 minimum, Kamby keeps a small fee shown only as a dollar amount) and challenge them to a
 * duel (no money at stake). Still the same WebRTC path: well under a second behind.
 */

export const LIVE_LIMITS = {
  titleMax: 60,
  chatMax: 200,
  chatCooldownMs: 1500,
  chatKeep: 100,
  reportsToEnd: 3,
  heartbeatMs: 15_000,
  /** A host silent this long has dropped — the room ends. */
  hostStaleMs: 45_000,
  viewerStaleMs: 45_000,
  /** How long the host's "silence" keeps someone out of the chat. */
  silenceMs: 10 * 60_000,
  tipMinUsd: 5,
  tipMaxUsd: 1_000,
  /** Kamby's cut of a tip, in basis points — never shown as a percentage (owner rule). */
  tipFeeBps: 300,
} as const;

export type LiveTrackKind = 'audio' | 'screen' | 'camera';

/** Kamby's fee on a tip of `amountUsd`, in whole cents. */
export function liveTipFeeUsd(amountUsd: number): number {
  return Math.round((amountUsd * LIVE_LIMITS.tipFeeBps) / 100) / 100;
}

export type LiveTipChain = 'solana' | 'base' | 'bnb' | 'robinhood';

/** A tip ready to sign: Solana is one transaction (Kamby pays its fee), EVM is two transfers in order. */
export interface LiveTipQuote {
  tipId: string;
  chain: LiveTipChain;
  amountUsd: number;
  feeUsd: number;
  solanaTransactionBase64?: string;
  evmTransactions?: { chainId: number; to: string; data: string; value: string }[];
}

export interface LiveHost {
  userId: string;
  username: string;
  avatarUrl: string | null;
  walletAddress: string | null;
  /** The host's EVM wallet — their Hyperliquid (perps) account too. */
  evmAddress?: string | null;
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
  /** The host's pinned Trade Card (2026-10-17) — viewers can ⚡ Copy Snipe it. */
  trade?: DmTrade | null;
  /** A chat line the host pinned over the chat (2026-10-31, like Twitch / YouTube). */
  pinned?: LiveChatLine | null;
  /** Slow mode: seconds each person waits between messages (0 = off). */
  slowSec?: number;
  /** The host's poll, open or just closed (results stay up a minute). */
  poll?: LivePoll | null;
  /** This stream's biggest tippers, most first (up to 3). */
  topTippers?: { username: string; avatarUrl: string | null; usd: number }[];
}

/**
 * A live poll (2026-10-31, like Twitch / YouTube Live): the host asks, viewers tap an answer.
 * Votes only — no money, no stakes.
 */
export interface LivePoll {
  id: string;
  question: string;
  options: { text: string; votes: number }[];
  endsAt: string;
  closed: boolean;
}

export const LIVE_POLL_LIMITS = { questionMax: 100, optionMax: 40, minOptions: 2, maxOptions: 4, durations: [30, 60, 120, 300] } as const;

/** Slow mode choices, in seconds. */
export const LIVE_SLOW_OPTIONS = [0, 5, 15, 30] as const;

export interface LiveChatLine {
  id: string;
  userId: string;
  username: string;
  avatarUrl: string | null;
  body: string;
  at: string;
  host: boolean;
  /** Not typed by anyone: a Kamby trade ("bought $120 of $WIF") or a tip, from the server. */
  kind?: 'trade' | 'tip';
  amountUsd?: number;
}

export const LIVE_REALTIME_CHANNEL = 'kamby:live';
/** Floating reactions (2026-10-31): the only emojis a viewer can send over the stage. */
export const LIVE_REACTIONS = ['❤️', '🔥', '🚀', '💎', '😂', '👀'] as const;
export type LiveReaction = (typeof LIVE_REACTIONS)[number];

/** What the host sees when they end their stream (2026-10-31). */
export interface LiveSummary {
  durationSec: number;
  peakViewers: number;
  tips: number;
  tipsUsd: number;
  chatLines: number;
  reactions: number;
}

export type LiveEvent =
  | { type: 'room'; roomId: string; room: LiveRoom }
  | { type: 'react'; roomId: string; emoji: LiveReaction }
  | { type: 'chat'; roomId: string; line: LiveChatLine }
  | { type: 'removed'; roomId: string; lineId: string }
  | { type: 'ended'; roomId: string };
