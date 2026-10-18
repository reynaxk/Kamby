/**
 * ⚔️ PvP trading duels (2026-10-17). Two traders, a short window, and a score that can't be
 * faked: the % PnL of what each BUYS during the duel on Kamby — parts sold during it count at
 * their real proceeds, the rest at the live price. No trade = no score (you lose to anyone who
 * traded; nobody trading is a draw). No stakes, ever (owner's call, confirmed 2026-10-18 over a
 * paid-entry version) — wins, streaks and badges. Coins a player launched themselves on Kamby's
 * LaunchPad never count toward their score (they could pump their own coin).
 */

export const DUEL_LIMITS = {
  minutes: [5, 15, 30, 60] as const,
  /** A challenge nobody answers lapses after this. */
  pendingMinutes: 10,
  /** An open duel waits in the lobby this long for someone to join. */
  openMinutes: 30,
  reactions: ['🔥', '🚀', '😂', '💀', '👀', '🫡'] as const,
  /** Arena / card refresh while a duel is live. */
  pollMs: 3_000,
} as const;

export type DuelMinutes = (typeof DUEL_LIMITS.minutes)[number];
export type DuelStatus = 'open' | 'pending' | 'live' | 'done' | 'declined' | 'expired' | 'cancelled';

export interface DuelTrade {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  logoUrl: string | null;
  amountUsd: number;
  at: string;
}

export interface DuelSide {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  /** % PnL on the duel's buys (live while it runs, frozen at the end); null = hasn't traded. */
  pct: number | null;
  investedUsd: number;
  trades: DuelTrade[];
  /** All-time duel wins — the badge. */
  wins: number;
}

export interface DuelState {
  id: string;
  conversationId: string | null;
  status: DuelStatus;
  minutes: number;
  createdAt: string;
  startedAt: string | null;
  endsAt: string | null;
  /** When an unanswered challenge lapses. */
  expiresAt: string;
  challenger: DuelSide;
  /** For an open duel still waiting in the lobby: an empty side (userId '', no name). */
  opponent: DuelSide;
  /** null while running, and for a draw. */
  winnerId: string | null;
  /** Cheers from the crowd, per side. */
  reactions: { challenger: Record<string, number>; opponent: Record<string, number> };
  /** The viewer (null when signed out). */
  meId: string | null;
}

/** Exported for tests. Who won: the higher % — someone who traded beats someone who didn't;
 *  equal (or nobody traded) is a draw (null). */
export function duelWinner(challenger: { userId: string; pct: number | null }, opponent: { userId: string; pct: number | null }): string | null {
  if (challenger.pct === null && opponent.pct === null) return null;
  if (opponent.pct === null) return challenger.userId;
  if (challenger.pct === null) return opponent.userId;
  if (Math.abs(challenger.pct - opponent.pct) < 1e-9) return null;
  return challenger.pct > opponent.pct ? challenger.userId : opponent.userId;
}

/** The month's top duelists (2026-10-18). */
export interface DuelLeader {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  wins: number;
  played: number;
  /** Wins in a row, counting back from their latest finished duel. */
  streak: number;
}
