/**
 * Stories (2026-10-17, owner: "Kamby is a mix of a memecoin terminal, Instagram, Discord…"):
 * a row of circles on Home, one per trader with a winning sell in the last 24 hours. Tap one
 * and their wins play full-screen as PnL cards. Only real, realized PnL (the same numbers the
 * leaderboard uses) — never typed in, never unrealized.
 */
export const STORY_LIMITS = {
  windowHours: 24,
  maxPeople: 20,
  maxPerPerson: 5,
  /** Each story shows this long before moving on. */
  secondsPerCard: 5,
} as const;

export interface StoryCard {
  /** Stable per (person, coin, day) — the app remembers which ones you've seen. */
  id: string;
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  logoUrl: string | null;
  pnlUsd: number;
  pnlPct: number;
  investedUsd: number;
  at: string;
}

export interface StoryPerson {
  userId: string;
  username: string;
  avatarUrl: string | null;
  walletAddress: string | null;
  /** You follow them — they come first. */
  followed: boolean;
  cards: StoryCard[];
  latestAt: string;
}
