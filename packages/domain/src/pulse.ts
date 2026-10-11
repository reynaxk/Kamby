import { z } from 'zod';

/**
 * Pulse — Kamby's worldwide chat (2026-10-11, owner: the Feed tab "is not useful … make it a
 * worldwide chat where traders can talk about coins, hype, news"). Pure rules shared by the API
 * (which enforces them) and the app (which explains them before you hit send).
 */
export const PULSE_REALTIME_CHANNEL = 'kamby:pulse:new';

export const PULSE_LIMITS = {
  maxLength: 280,
  /** One message per user per this many seconds. */
  cooldownSeconds: 3,
  /** The same text again within this window is refused as spam. */
  duplicateWindowSeconds: 60,
  pageSize: 50,
} as const;

/**
 * No links in Pulse — in a trading chat almost every link is a scam ("claim airdrop", fake
 * sites, drainers). Catches schemes, www., bare domains on common TLDs and Telegram/Discord
 * invites. Coins are mentioned as $SYMBOL instead.
 */
const LINK_PATTERN =
  /(https?:\/\/|www\.|t\.me\/|discord\.(gg|com)|\b[a-z0-9-]{2,}\.(com|io|xyz|app|net|org|gg|me|co|fun|finance|exchange|site|online|link|live|top|club|pro|vip|cc|ru|io)\b)/i;

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

/** Trimmed, inner whitespace runs collapsed (a wall of spaces/newlines is still spam). */
export function normalizePulseBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const PulseMessageSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string().datetime(),
  author: z.object({
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    /** The author's verified wallet, for the profile link — null if they have none. */
    address: z.string().nullable(),
  }),
});
export type PulseMessage = z.infer<typeof PulseMessageSchema>;

export const PulsePageSchema = z.object({
  items: z.array(PulseMessageSchema),
  /** Pass as `before` to load older messages; null when there are none. */
  nextBefore: z.string().nullable(),
});
export type PulsePage = z.infer<typeof PulsePageSchema>;
