import type { CallState } from './calls';

/**
 * Private messages between two Kamby users (2026-10-17, owner: "chat with another user on their
 * private chat like instagram"). Owner's calls: anyone can write to anyone, but a first message
 * from someone you don't both follow lands in Requests until it's accepted (Instagram-style);
 * messages carry text with emoji reactions, a coin card, a PnL card built from the sender's real
 * position, or a USDC transfer checked on-chain. No links (same rule as Pulse), no images yet.
 */

export const DM_LIMITS = {
  maxLength: 1000,
  pageSize: 40,
  /** New conversations one user may start per day — spam brake. */
  newPerDay: 20,
  /** Messages a sender may write into a request that hasn't been accepted yet. */
  requestMessagesMax: 3,
  /** Minimum gap between two messages from one user. */
  cooldownMs: 700,
  /** One phone push per conversation per this many minutes (a burst of lines is one buzz). */
  pushBucketMinutes: 5,
  /** A "typing…" signal lasts this long on the other side. */
  typingTtlMs: 4000,
  /** Group chats (2026-10-17, owner: up to 32 people). */
  groupMaxMembers: 32,
  groupTitleMax: 40,
  /** Communities (Discord-style, 2026-10-17): bigger, with channels; the voice lounge stays a
   *  call (up to CALL_LIMITS.maxParticipants). */
  communityMaxMembers: 250,
  channelNameMax: 24,
  maxChannels: 20,
} as const;

/** Reactions on a private message — the same set as a coin's chat. */
export const DM_REACTIONS = ['❤️', '😂', '🔥', '🚀', '💎', '👀', '😭', '🫡'] as const;
export function isDmReaction(value: string): boolean {
  return (DM_REACTIONS as readonly string[]).includes(value);
}

/** 'system' = a group event line ("@sandy added @tati"), written by the server. */
export type DmMessageKind = 'text' | 'coin' | 'pnl' | 'usdc' | 'trade' | 'system';

export interface DmSystem {
  /** 'call' = a call ended (durationSec) or was missed (durationSec 0). */
  event: 'created' | 'createdCommunity' | 'added' | 'joined' | 'removed' | 'left' | 'renamed' | 'call';
  actor: string | null;
  targets: string[];
  title?: string;
  durationSec?: number;
  video?: boolean;
}

export interface DmCoin {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
}

export interface DmPnl {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  logoUrl: string | null;
  pnlUsd: number;
  pnlPct: number;
  investedUsd: number;
  valueUsd: number;
}

/** A Trade Card (2026-10-17): a buy the trader chose to share — their real open position on the
 *  coin (entry = what they paid per coin, Kamby's fee left out). The live PnL is worked out in
 *  the app from the current price; anyone can ⚡ Copy Snipe it from the card. */
export interface DmTrade {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  entryPriceUsd: number;
  investedUsd: number;
  sharedAt: string;
}

export interface DmUsdc {
  amountUsd: number;
  chainIdentifier: string;
  txRef: string;
}

export interface DmMessage {
  id: string;
  conversationId: string;
  senderId: string;
  kind: DmMessageKind;
  body: string;
  coin: DmCoin | null;
  pnl: DmPnl | null;
  usdc: DmUsdc | null;
  trade: DmTrade | null;
  system: DmSystem | null;
  /** The community channel it was written in (null outside communities). */
  channelId: string | null;
  /** The line this one answers (a quote of it, kept with the reply). */
  replyTo: DmReplyRef | null;
  /** emoji → the users who reacted with it. */
  reactions: Record<string, string[]>;
  createdAt: string;
}

export interface DmReplyRef {
  id: string;
  senderId: string;
  username: string | null;
  /** A short preview of the quoted line ("$DOPE PnL card", the first words of a text…). */
  preview: string;
}

/** @names in a text (lowercase, without the @), at most 10 — for highlights and mention pushes. */
export function dmMentions(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(/(^|[^a-z0-9_.])@([a-z0-9_.]{3,21})/gi)) {
    out.add(m[2]!.toLowerCase());
    if (out.size >= 10) break;
  }
  return [...out];
}

export interface DmPerson {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  /** The wallet their profile page lives at, when they have one. */
  walletAddress: string | null;
}

/**
 * - `active`: a normal chat.
 * - `request`: someone you don't both follow wrote to you (or added you to a group) — accept it to reply.
 * - `pending`: you wrote first and they haven't accepted yet (1:1 only).
 */
export type DmConversationState = 'active' | 'request' | 'pending';

export interface DmChannelInfo {
  id: string;
  name: string;
  kind: 'text' | 'voice';
}

export interface DmGroup {
  title: string;
  ownerId: string;
  /** Everyone active in the group (at most DM_LIMITS.groupMaxMembers), you included. */
  members: DmPerson[];
  /** Set for a community: its channels and invite code (the link is /c/<code>). */
  community: { inviteCode: string | null; channels: DmChannelInfo[]; visibility: 'private' | 'gated' | 'public'; about: string | null } | null;
}

/** What an invite link shows before you join. */
export interface DmInvitePreview {
  conversationId: string;
  title: string;
  memberCount: number;
  members: DmPerson[];
  alreadyIn: boolean;
}

export interface DmConversation {
  id: string;
  /** Your own user id — tells your messages apart in a group. */
  meId: string;
  state: DmConversationState;
  /** The other person in a 1:1 chat; null in a group. */
  other: DmPerson | null;
  /** Set for a group chat. */
  group: DmGroup | null;
  lastMessage: { body: string; kind: DmMessageKind; senderId: string; createdAt: string } | null;
  unread: number;
  /** When the other side last read this chat — "Seen" under your last message. */
  otherReadAt: string | null;
  /** You blocked them (you can still see the history; they can't write). */
  blocked: boolean;
  /** People in this chat (not you) who have Kamby open right now — the green dot, "Active now". */
  onlineIds: string[];
  /** You muted this chat's notifications — until when (null = until you unmute). */
  mute: { until: string | null } | null;
}

/** Mute choices in minutes (null = until you turn it back on). */
export const DM_MUTE_OPTIONS = [60, 8 * 60, 7 * 24 * 60, null] as const;

/** Kamby open in a tab / the app checks in this often; quiet for onlineTtlSec = offline. */
export const DM_PRESENCE = { heartbeatMs: 30_000, onlineTtlSec: 75, viewingTtlSec: 40 } as const;

export interface DmUnread {
  /** Unread messages across your accepted chats. */
  messages: number;
  /** Message requests waiting for you. */
  requests: number;
}

/** What the private live stream carries (alongside notifications) — only to `userIds`. */
export const DM_REALTIME_CHANNEL = 'kamby:dm';
export type DmEvent =
  | { type: 'message'; userIds: string[]; conversationId: string; message: DmMessage }
  | { type: 'read'; userIds: string[]; conversationId: string; userId: string; atIso: string }
  | { type: 'typing'; userIds: string[]; conversationId: string; userId: string }
  | { type: 'reaction'; userIds: string[]; conversationId: string; messageId: string; reactions: Record<string, string[]> }
  | { type: 'state'; userIds: string[]; conversationId: string }
  /** A call in this chat started, changed or ended (call null = ended). */
  | { type: 'call'; userIds: string[]; conversationId: string; call: CallState | null };

const SCAM_BAIT = /\b(seed\s*phrase|secret\s*phrase|recovery\s*phrase|private\s*key|mnemonic|12\s*words|24\s*words|wallet\s*validat|kamby\s*(support|admin|team)|support\s*team|verify\s*your\s*wallet|airdrop\s*claim)\b/i;

/** Lines that look like the classic "send me your seed / I'm support" scam — the app shows a
 *  warning under them. A heuristic, never a block: real people can say these words too. */
export function looksLikeScamBait(text: string): boolean {
  return SCAM_BAIT.test(text);
}
