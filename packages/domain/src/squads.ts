/**
 * Squad Wars (2026-10-17) — communities ranked by what their people trade on Kamby this month.
 * A community joins the ranking only when its owner says so ('gated' = Request invite,
 * 'public' = anyone can Join); 'private' ones are never listed. Bragging rights only — no
 * rewards, no money.
 */

export type SquadVisibility = 'private' | 'gated' | 'public';
export type SquadSort = 'volume' | 'winrate';

export const SQUAD_LIMITS = {
  aboutMax: 140,
  /** Closed trades this month before a squad's win rate counts for the Win-rate ranking. */
  minClosedForWinRate: 5,
  /** How long the ranking is cached (it's month-to-date, minutes don't matter). */
  cacheSeconds: 300,
} as const;

export interface SquadTopToken {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  logoUrl: string | null;
}

export interface SquadSummary {
  conversationId: string;
  rank: number;
  title: string;
  about: string | null;
  visibility: Exclude<SquadVisibility, 'private'>;
  memberCount: number;
  /** Month-to-date: buys + sells, USD. */
  volumeUsd: number;
  swaps: number;
  /** Closed trades in profit / all closed trades this month (0..1); null with too few. */
  winRate: number | null;
  closedTrades: number;
  /** Most bought by the squad over the last 7 days. */
  topToken: SquadTopToken | null;
  /** You're already in it. */
  joined: boolean;
}

export interface SquadBoard {
  month: string;
  sort: SquadSort;
  squads: SquadSummary[];
}
