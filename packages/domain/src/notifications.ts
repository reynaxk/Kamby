import { z } from 'zod';

/**
 * Phase 4 notification domain — see docs/NOTIFICATIONS.md. Pure types, configuration, and
 * deterministic logic only (no I/O, matching every other file in this package); the actual
 * database writes live in apps/api (follow/like) and apps/workers (indexed-activity-driven
 * types), sharing this module so both agree on dedupe keys, deep links, and thresholds.
 */

export const NotificationTypeSchema = z.enum([
  'FOLLOW',
  'LIKE',
  'FOLLOWED_TRADER_TRADE',
  'WHALE_TRADE',
  'TRENDING_TOKEN',
  'WATCHED_TOKEN_ACTIVITY',
  /** 2026-10-11 — your own trade landed / failed on-chain (EVM or Solana). */
  'TRADE_CONFIRMED',
  'TRADE_FAILED',
  /** 2026-10-11 — a big price move on a coin you hold or watch. */
  'PRICE_MOVE',
  /** 2026-10-15 — another Kamby user sent you USDC by your @username (checked on-chain). */
  'USDC_RECEIVED',
  /** 2026-10-17 — a private message (phone push only; never listed with the notifications). */
  'DM_MESSAGE',
  /** 2026-10-17 — someone you follow went live (voice / screen room). */
  'LIVE_STARTED',
  /** 2026-10-17 — someone is calling you in a chat (phone push only). */
  'CALL_INCOMING',
  /** 2026-10-28 — a call (voice or video) you didn't pick up; listed and pushed. */
  'CALL_MISSED',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * Centralized, not scattered across controllers/workers — see docs/NOTIFICATIONS.md#whale-trades
 * and #trending-tokens. Every one of these can be overridden by env config; these are only
 * the shipped defaults.
 */
export const NOTIFICATION_DEFAULTS = {
  /** A single trade at/above this USD value is a "whale trade." */
  whaleTradeUsdThreshold: 25_000,
  /** Bounds notification explosions when one token receives many large trades in a burst —
   *  at most one WHALE_TRADE notification batch per token per this many minutes. See
   *  docs/NOTIFICATIONS.md#whale-trades. */
  whaleTradeCooldownMinutes: 15,
  /** Every preference defaults to enabled — see docs/NOTIFICATIONS.md#preferences for why
   *  an opt-out model fits a "make Kamby feel alive" product better than opt-in. */
  preferenceDefaults: {
    follows: true,
    likes: true,
    followedTraderTrades: true,
    whaleTrades: true,
    trendingTokens: true,
    watchedTokenActivity: true,
    tradeUpdates: true,
    priceMoves: true,
    messages: true,
    pushEnabled: true,
  },
  /** PRICE_MOVE fires when a held/watched coin moves at least this much within the window
   *  — at most once per coin, direction and window bucket (see priceMoveDedupeKey). */
  priceMovePct: 15,
  priceMoveWindowMinutes: 60,
} as const;

export const NotificationPreferencesSchema = z.object({
  follows: z.boolean(),
  likes: z.boolean(),
  followedTraderTrades: z.boolean(),
  whaleTrades: z.boolean(),
  trendingTokens: z.boolean(),
  watchedTokenActivity: z.boolean(),
  tradeUpdates: z.boolean(),
  priceMoves: z.boolean(),
  /** 2026-10-17 — private messages (DM_MESSAGE). */
  messages: z.boolean(),
  /** Phone (Web Push) delivery at all — the per-type switches still apply on top. */
  pushEnabled: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

/** Which preference gates a given notification type — the single place that mapping is
 *  defined, so a controller/worker never hardcodes "whaleTrades gates WHALE_TRADE" itself. */
export const NOTIFICATION_PREFERENCE_FIELD: Record<
  NotificationType,
  keyof NotificationPreferences
> = {
  FOLLOW: 'follows',
  LIKE: 'likes',
  FOLLOWED_TRADER_TRADE: 'followedTraderTrades',
  WHALE_TRADE: 'whaleTrades',
  TRENDING_TOKEN: 'trendingTokens',
  WATCHED_TOKEN_ACTIVITY: 'watchedTokenActivity',
  TRADE_CONFIRMED: 'tradeUpdates',
  TRADE_FAILED: 'tradeUpdates',
  PRICE_MOVE: 'priceMoves',
  USDC_RECEIVED: 'tradeUpdates',
  DM_MESSAGE: 'messages',
  CALL_INCOMING: 'messages',
  CALL_MISSED: 'messages',
  LIVE_STARTED: 'follows',
};

/**
 * Structured context stored on a notification that has no related row to read it from
 * (2026-10-11): TRADE_* (the recipient's own trade) and PRICE_MOVE. Facts only — the app and
 * the push dispatcher both render the words from these fields, in the reader's language.
 */
export const NotificationPayloadSchema = z.object({
  chainIdentifier: z.string().optional(),
  tokenAddress: z.string().optional(),
  symbol: z.string().nullable().optional(),
  logoUrl: z.string().nullable().optional(),
  side: z.enum(['BUY', 'SELL']).optional(),
  amountUsd: z.number().nullable().optional(),
  /** EVM trades only — /trades/[id] shows it; Solana trades link to the coin instead. */
  tradeId: z.string().optional(),
  /** PRICE_MOVE: the % move and the window it happened in. */
  pct: z.number().optional(),
  windowMinutes: z.number().optional(),
  /** DM_MESSAGE / CALL_INCOMING (2026-10-17): which chat, its name (groups / communities), a
   *  short preview of the line, and what happened — so the push reads like Instagram's
   *  ("@tati: gm") and opens that chat. */
  conversationId: z.string().optional(),
  chatTitle: z.string().nullable().optional(),
  preview: z.string().optional(),
  dmKind: z.enum(['message', 'mention', 'reply', 'reaction', 'added', 'accepted', 'duelAccepted', 'duelResult']).optional(),
  emoji: z.string().optional(),
  /** LIVE_STARTED: the room to open and its title. */
  liveRoomId: z.string().optional(),
  liveTitle: z.string().optional(),
  /** CALL_MISSED: a video call (true) or a voice call. */
  callVideo: z.boolean().optional(),
});
export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;

/**
 * The idempotency key within one (userId, type) pair — see docs/NOTIFICATIONS.md#idempotency.
 * Persisted as `Notification.dedupeKey`, enforced by `@@unique([userId, type, dedupeKey])`.
 * Never rely on in-memory dedup alone; these functions exist so every writer (API for
 * follow/like, worker for trade/whale/trending) builds the exact same key for the exact
 * same real-world event, regardless of how many times it's attempted.
 */
export function followDedupeKey(followerUserId: string): string {
  // Deliberately NOT per-follow-event: unfollowing and re-following the same trader must
  // never produce a second notification — see docs/NOTIFICATIONS.md#follow-notifications.
  return `follower:${followerUserId}`;
}
export function likeDedupeKey(likerUserId: string, swapId: string): string {
  return `liker:${likerUserId}:swap:${swapId}`;
}
export function followedTraderTradeDedupeKey(swapId: string): string {
  return `swap:${swapId}`;
}
export function whaleTradeDedupeKey(swapId: string): string {
  return `swap:${swapId}`;
}
/** Same shape as `whaleTradeDedupeKey` — the (userId, type, dedupeKey) unique constraint
 *  already keeps this distinct per recipient and per notification type, so a plain
 *  swap-keyed string is enough; see NotificationFanoutService#notifyWatchedTokenActivity. */
export function watchedTokenActivityDedupeKey(swapId: string): string {
  return `swap:${swapId}`;
}
/** `transitionAtIso` ties this key to one specific "entered trending" event — see
 *  docs/NOTIFICATIONS.md#trending-tokens. A later re-entry (a new transition) gets a new
 *  key and so can notify again; the same continuous trending streak never repeats. */
export function trendingTokenDedupeKey(tokenMarketId: string, transitionAtIso: string): string {
  return `token:${tokenMarketId}:since:${transitionAtIso}`;
}
/** One per trade and outcome — a retried status poll never notifies twice. */
export function tradeOutcomeDedupeKey(chain: 'evm' | 'solana', tradeId: string): string {
  return `trade:${chain}:${tradeId}`;
}
/** One per incoming transfer (its transaction hash / signature). */
export function usdcReceivedDedupeKey(txRef: string): string {
  return `transfer:${txRef}`;
}
/** At most one PRICE_MOVE per coin, direction and window bucket (e.g. one "up" per hour). */
export function priceMoveDedupeKey(tokenKey: string, direction: 'up' | 'down', bucketStartIso: string): string {
  return `move:${tokenKey}:${direction}:${bucketStartIso}`;
}

/** A coin's page in the app, by its exact chain — '/market/<address>' alone always meant
 *  Base, so BNB coins opened the wrong page (2026-10-11). */
export function tokenDeepLink(chainIdentifier: string | null | undefined, tokenAddress: string): string {
  if (chainIdentifier === 'solana') return `/solana?mint=${encodeURIComponent(tokenAddress)}`;
  if (chainIdentifier === 'eip155:56') return `/market/bnb/${tokenAddress}`;
  if (chainIdentifier === 'eip155:4663') return `/market/robinhood/${tokenAddress}`;
  if (chainIdentifier === 'eip155:8453') return `/market/base/${tokenAddress}`;
  return `/market/${tokenAddress}`;
}

/**
 * Deterministic destination for an actionable notification — see
 * docs/NOTIFICATIONS.md#deep-links. Uses this app's real routes (`/trader/[address]`,
 * `/market/[address]`), never an invented URL shape. `null` when the notification has
 * nothing to link to (e.g. an actor with no linked wallet) — never a fabricated link.
 */
export function notificationDeepLink(
  type: NotificationType,
  ctx: {
    actorWalletAddress: string | null;
    tokenAddress: string | null;
    chainIdentifier?: string | null;
    tradeId?: string | null;
    conversationId?: string | null;
    liveRoomId?: string | null;
  },
): string | null {
  switch (type) {
    case 'FOLLOW':
      return ctx.actorWalletAddress ? `/trader/${ctx.actorWalletAddress}` : null;
    case 'TRADE_CONFIRMED':
    case 'TRADE_FAILED':
      if (ctx.tradeId) return `/trades/${ctx.tradeId}`;
      return ctx.tokenAddress ? tokenDeepLink(ctx.chainIdentifier, ctx.tokenAddress) : '/trades';
    case 'LIKE':
    case 'FOLLOWED_TRADER_TRADE':
    case 'WHALE_TRADE':
    case 'TRENDING_TOKEN':
    case 'WATCHED_TOKEN_ACTIVITY':
    case 'PRICE_MOVE':
      return ctx.tokenAddress ? tokenDeepLink(ctx.chainIdentifier, ctx.tokenAddress) : null;
    case 'USDC_RECEIVED':
      return '/';
    case 'DM_MESSAGE':
    case 'CALL_INCOMING':
    case 'CALL_MISSED':
      return ctx.conversationId ? `/messages/${ctx.conversationId}` : '/messages';
    case 'LIVE_STARTED':
      return ctx.liveRoomId ? `/live/${ctx.liveRoomId}` : '/home';
  }
}

/** One notification as the API serves it — structured fields only, never a pre-rendered
 *  sentence (see docs/NOTIFICATIONS.md#notification-center): the client renders copy per
 *  `type` from these fields, the same way `ActivityCard` already renders "Bought"/"Sold"
 *  from structured `SocialActivity` fields rather than a server-composed string. */
export const NotificationActorSchema = z.object({
  /** Nullable for the same reason `SocialActivity.trader.address` is (see social.ts): the
   *  acting user may have no verified wallet at all (following requires only an
   *  authenticated session, not a linked wallet). The UI falls back to generic copy and no
   *  deep link when this is null. */
  address: z.string().nullable(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
});
export type NotificationActor = z.infer<typeof NotificationActorSchema>;

export const NotificationTokenContextSchema = z.object({
  address: z.string(),
  symbol: z.string().nullable(),
  logoUrl: z.string().nullable(),
});
export type NotificationTokenContext = z.infer<typeof NotificationTokenContextSchema>;

export const NotificationDtoSchema = z.object({
  id: z.string().uuid(),
  type: NotificationTypeSchema,
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
  actor: NotificationActorSchema.nullable(),
  token: NotificationTokenContextSchema.nullable(),
  /** Trade value in USD — set for FOLLOWED_TRADER_TRADE/WHALE_TRADE, null otherwise. */
  amountUsd: z.number().nullable(),
  side: z.enum(['BUY', 'SELL']).nullable(),
  /** PRICE_MOVE: the % move (signed) — absent/null for every other type. */
  pct: z.number().nullable().optional(),
  /** CALL_MISSED: whether it was a video call. */
  video: z.boolean().nullable().optional(),
  deepLink: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof NotificationDtoSchema>;

/** Keyset cursor for the notification list — same reasoning as `ActivityCursor` in
 *  social.ts (a constantly-growing, per-user feed doesn't paginate safely by offset), kept
 *  as its own small type rather than generalized since it's keyed on `createdAt`, not
 *  `blockTimestamp`. */
export const NotificationCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});
export type NotificationCursor = z.infer<typeof NotificationCursorSchema>;

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Returns `null` for anything malformed — untrusted client input, same contract as
 *  `decodeActivityCursor`: garbage means "start from the beginning," never a 500. */
export function decodeNotificationCursor(raw: string): NotificationCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = NotificationCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const NotificationPageSchema = z.object({
  items: z.array(NotificationDtoSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/**
 * The bare realtime ping — see docs/NOTIFICATIONS.md#realtime-delivery. Deliberately small
 * (never the full notification payload) so SSE fan-out stays cheap regardless of how much
 * context a notification eventually carries; the client re-fetches the real thing over the
 * normal authenticated REST endpoint on receiving one, same "ping, then refetch" pattern
 * Phase 2's activity stream already established.
 */
export const NOTIFICATION_REALTIME_CHANNEL = 'kamby:notifications:new';
export interface NotificationPing {
  userId: string;
  notificationId: string;
  type: NotificationType;
  atIso: string;
}
