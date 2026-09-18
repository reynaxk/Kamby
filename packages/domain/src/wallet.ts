import { z } from 'zod';
import { TraderRealizedPnlSchema } from './pnl';

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
/** Base58 (Bitcoin alphabet — no 0, O, I, l), 32-44 chars: the real length range of a
 *  base58-encoded 32-byte Solana public key. Format only, same caveat as isEvmAddress —
 *  never proof of ownership or that the address has ever been used on-chain. */
const SOLANA_ADDRESS_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** True for a syntactically valid EVM address (0x + 40 hex chars) — format only, never
 *  proof of ownership or that the address has ever been used on-chain. */
export function isEvmAddress(address: string): boolean {
  return EVM_ADDRESS_PATTERN.test(address);
}

/** Canonical form used everywhere an address is stored or compared, so "0xABC…" and
 *  "0xabc…" are always the same wallet — see docs/SOCIAL.md#trader-identity. */
export function normalizeEvmAddress(address: string): string {
  return address.toLowerCase();
}

/** True for a syntactically plausible Solana address — format only, same caveat as
 *  isEvmAddress. Unlike EVM addresses, Solana base58 is already case-sensitive/canonical
 *  by construction — there is no normalizeSolanaAddress equivalent, lowercasing would
 *  actively corrupt a valid address. */
export function isSolanaAddress(address: string): boolean {
  return SOLANA_ADDRESS_PATTERN.test(address);
}

/**
 * A wallet's public trading identity. Rows are created lazily by the ingestion worker the
 * first time an address is observed as a swap's trader — never by a user action. Not a
 * user account; see docs/WALLET_SECURITY.md's wallet-first identity model. No
 * `displayName`/`avatarUrl` here — that identity pair moved to `User` (one consistent
 * handle across a person's several verified wallets/chains) in the realized-PnL/
 * leaderboard phase; see `USERNAME_PATTERN` below and `TraderProfileSchema.username`.
 */
export const WalletSchema = z.object({
  address: z.string().refine(isEvmAddress, 'not a valid EVM address'),
  firstSeenAt: z.string().datetime(),
});
export type Wallet = z.infer<typeof WalletSchema>;

/** 3–20 chars, lowercase letters/digits/underscore only — a handle meant to be typed and
 *  read aloud, not a free-text display name. Stored lowercase (see `normalizeUsername`)
 *  so the DB's unique constraint is genuinely case-insensitive: "Alice" and "alice" can't
 *  both be claimed. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_PATTERN = /^[a-z0-9_]+$/;

/** A minimal anti-impersonation blocklist — never exhaustive, and not a substitute for
 *  real moderation (out of scope for this phase, see docs/TRADER_INTELLIGENCE.md#realized-pnl),
 *  just enough to stop the most obvious "@kamby" / "@admin"-style impersonation attempts
 *  at signup time rather than after the fact. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'kamby', 'admin', 'administrator', 'support', 'moderator', 'mod', 'staff', 'official',
  'system', 'root', 'null', 'undefined', 'api',
]);

/** Lowercases a username for storage/comparison — the one normalization step every
 *  reader/writer of `User.username` must apply, so "Alice"/"alice" are never treated as
 *  two different handles. Never applied to a `Wallet.address` (already
 *  case-normalized separately by `normalizeEvmAddress`, and Solana base58 addresses are
 *  case-sensitive by construction — see `isSolanaAddress`'s own comment). */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

/** Format + reserved-word validation only — never proof of actual availability, which
 *  needs a real uniqueness check against `User.username` (a 409 on collision, not
 *  something this pure function can know). */
export function isValidUsername(username: string): boolean {
  const normalized = normalizeUsername(username);
  if (normalized.length < USERNAME_MIN_LENGTH || normalized.length > USERNAME_MAX_LENGTH) return false;
  if (!USERNAME_PATTERN.test(normalized)) return false;
  if (RESERVED_USERNAMES.has(normalized)) return false;
  return true;
}

/**
 * Trading statistics computed directly from indexed `swaps` — only metrics that can be
 * computed correctly from what's actually indexed (raw on-chain pool activity, not
 * ownership/cost-basis-aware). Deliberately still no profit/ROI/PnL/win rate here even
 * after the realized-PnL phase — that figure needs a completely different,
 * Kamby-originated-trades-only data model (see `TraderProfileSchema.realizedPnl` /
 * `TraderRealizedPnlSchema` in pnl.ts) and would be actively wrong if computed from
 * `swaps` the way every other field here is. See docs/SOCIAL.md#trader-stats,
 * docs/TRADER_INTELLIGENCE.md (Phase 5), and docs/TRADER_INTELLIGENCE.md#realized-pnl.
 */
export const TraderStatsSchema = z.object({
  totalSwaps: z.number().int().min(0),
  buyCount: z.number().int().min(0),
  sellCount: z.number().int().min(0),
  volumeUsd: z.number().min(0),
  firstSeenAt: z.string().datetime(),
  lastActiveAt: z.string().datetime().nullable(),

  // Phase 5 — see docs/TRADER_INTELLIGENCE.md#trader-statistics for every formula. All
  // additive/nullable so this never breaks an existing consumer of TraderStats.
  /** Distinct token markets this wallet has traded, all-time. */
  uniqueTokensTraded: z.number().int().min(0),
  /** volumeUsd / totalSwaps — null (not 0) when totalSwaps is 0; an average of zero trades
   *  is undefined, not a real zero-sized average trade. */
  avgTradeSizeUsd: z.number().min(0).nullable(),
  /** The single largest confirmed trade by USD value, all-time. Null when totalSwaps is 0. */
  largestTradeUsd: z.number().min(0).nullable(),
  /** Trailing 24h volume — a real, possibly-zero recent figure once the wallet has traded
   *  at least once; never null just because nothing happened in the last 24h. */
  volume24hUsd: z.number().min(0),
  tradeCount24h: z.number().int().min(0),
  /** buyCount / totalSwaps, in [0, 1] — 1 means buy-only, 0 means sell-only. Null when
   *  totalSwaps is 0. */
  buyRatio: z.number().min(0).max(1).nullable(),
  /** Herfindahl-Hirschman-style concentration of volume across traded tokens, in (0, 1] —
   *  1 means all volume in a single token, closer to 0 means spread across many. Null when
   *  totalSwaps is 0. See computeConcentrationIndex in trader-intelligence.ts. */
  concentrationIndex: z.number().min(0).max(1).nullable(),
  /** totalSwaps / days-since-firstSeenAt (minimum 1 day) — trades per day, averaged over
   *  the wallet's whole tracked history. Null when totalSwaps is 0. */
  activityFrequencyPerDay: z.number().min(0).nullable(),
});
export type TraderStats = z.infer<typeof TraderStatsSchema>;

/**
 * A trader's public profile — the shape `/trader/[address]` and `GET
 * /social/traders/:address` both read. `isFollowedByMe` is `null` (not `false`) for an
 * unauthenticated caller: there is no "me" to check against, and `false` would misrepresent
 * that as a definite answer. See docs/SOCIAL.md#trader-identity.
 *
 * `username`/`avatarUrl` are real, user-set identity from the wallet's linked `User` (see
 * `Wallet`'s own doc comment on why these moved off `Wallet` itself) — both null when the
 * wallet has no linked `User`, or a `User` who hasn't set them, never a generated
 * fallback. `realizedPnl` is `null` (the whole object) under that same "no linked `User`"
 * condition — see `TraderRealizedPnlSchema` in pnl.ts for what it looks like otherwise.
 */
export const TraderProfileSchema = z.object({
  address: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  stats: TraderStatsSchema,
  followerCount: z.number().int().min(0),
  followingCount: z.number().int().min(0),
  isFollowedByMe: z.boolean().nullable(),
  realizedPnl: TraderRealizedPnlSchema.nullable(),
});
export type TraderProfile = z.infer<typeof TraderProfileSchema>;

/**
 * One row of the "Top Traders" ranking — ranked by real, measured 24h volume among traders
 * clearing a minimum trade-count floor (a single huge trade shouldn't win "most active" any
 * more than it should win trending — see TrendingService). Still no "smart money" claim —
 * volume ranks activity, not profitability; see `LeaderboardEntrySchema` in pnl.ts for the
 * separate, real PnL-ranked leaderboard added in a later phase. See
 * docs/SOCIAL.md#trader-discovery.
 */
export const TopTraderSchema = z.object({
  address: z.string(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  volumeUsd: z.number(),
  tradeCount: z.number().int(),
});
export type TopTrader = z.infer<typeof TopTraderSchema>;
