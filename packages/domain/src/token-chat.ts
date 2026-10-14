import { z } from 'zod';

/**
 * Token chat — a live, Twitch-style chat on every coin's screen (2026-10-14, owner idea). Built on
 * Pulse (same table, same rules: no links, a 3s cooldown, a username to post), scoped to one coin
 * by `tokenKey`. Kamby users' own buys and sells stream into it too, so a coin's chat is alive
 * even when nobody is typing. Owner calls (2026-10-14): trades in the chat; a "Chat" tab on
 * phones; report + auto-hide after REPORTS_TO_HIDE reports; PnL posts only from the poster's
 * real position, built by the server — never numbers the app sends.
 */
export const TOKEN_CHAT_REALTIME_CHANNEL = 'kamby:token-chat';

export const TOKEN_CHAT_LIMITS = {
  /** Messages (plus trades) a chat loads on open, and the most it keeps on screen. */
  pageSize: 60,
  maxOnScreen: 150,
  /** Kamby trades on the coin shown from this far back. */
  tradeLookbackHours: 24,
  /** One reaction per user per this many ms. */
  reactionCooldownMs: 400,
  /** Reports from this many different users hide a message for everyone. */
  reportsToHide: 3,
  /** 🐳 next to a name: holds at least this much of the coin. */
  whaleUsd: 1_000,
  /** ⚡ next to a name: in the top this-many of the 7-day leaderboard. */
  topTraderRank: 10,
} as const;

/** The reactions anyone can send. The bar shows four (DEFAULT_REACTIONS, or your own picks). */
export const TOKEN_CHAT_REACTIONS = ['🚀', '💎', '🤡', '📉', '🔥', '🐳', '💀', '😭', '🤑', '👀', '🫡', '❤️', '😂', '🙏', '⚡', '🌙'] as const;
export const DEFAULT_REACTIONS = ['🚀', '💎', '🤡', '📉'] as const;

export function isTokenChatReaction(value: string): boolean {
  return (TOKEN_CHAT_REACTIONS as readonly string[]).includes(value);
}

/**
 * One coin's chat room: `solana:<mint>` (mints are case-sensitive) or `eip155:<chainId>:<0x…>`
 * (lower-cased). Null for anything that isn't a well-formed coin address.
 */
export function chatTokenKey(chainIdentifier: string, address: string): string | null {
  if (chainIdentifier === 'solana') return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) ? `solana:${address}` : null;
  const chain = /^eip155:(\d{1,7})$/.exec(chainIdentifier);
  if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return `eip155:${chain[1]}:${address.toLowerCase()}`;
}

export function isChatTokenKey(key: string): boolean {
  if (key.startsWith('solana:')) return chatTokenKey('solana', key.slice(7)) === key;
  const parts = key.split(':');
  return parts.length === 3 && chatTokenKey(`${parts[0]}:${parts[1]}`, parts[2]!) === key;
}

export const TokenChatBadgeSchema = z.enum(['whale', 'top', 'dev']);
export type TokenChatBadge = z.infer<typeof TokenChatBadgeSchema>;

const AuthorSchema = z.object({
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  address: z.string().nullable(),
});

/** A PnL flex, as the server worked it out from the poster's real position when they posted. */
export const TokenChatPnlSchema = z.object({
  symbol: z.string().nullable(),
  logoUrl: z.string().nullable(),
  pnlUsd: z.number(),
  pnlPct: z.number().nullable(),
  investedUsd: z.number(),
  valueUsd: z.number(),
});
export type TokenChatPnl = z.infer<typeof TokenChatPnlSchema>;

export const TokenChatItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    id: z.string(),
    tokenKey: z.string(),
    body: z.string(),
    createdAt: z.string().datetime(),
    author: AuthorSchema,
    badges: z.array(TokenChatBadgeSchema),
  }),
  z.object({
    kind: z.literal('pnl'),
    id: z.string(),
    tokenKey: z.string(),
    createdAt: z.string().datetime(),
    author: AuthorSchema,
    badges: z.array(TokenChatBadgeSchema),
    pnl: TokenChatPnlSchema,
  }),
  /** A Kamby user's confirmed buy or sell of the coin. `id` is the trade's own id. */
  z.object({
    kind: z.literal('trade'),
    id: z.string(),
    tokenKey: z.string(),
    createdAt: z.string().datetime(),
    author: AuthorSchema,
    side: z.enum(['BUY', 'SELL']),
    usd: z.number(),
  }),
]);
export type TokenChatItem = z.infer<typeof TokenChatItemSchema>;

/** What the live stream sends besides new items: a flying reaction, or a message to take down. */
export type TokenChatEvent =
  | { type: 'item'; item: TokenChatItem }
  | { type: 'reaction'; tokenKey: string; emoji: string }
  | { type: 'hide'; tokenKey: string; id: string };
