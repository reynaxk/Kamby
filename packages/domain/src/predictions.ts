/**
 * Predictions (2026-10-31): free community forecasts — people vote on what happens next, and
 * auto-generated polls resolve themselves from real prices. Votes only: no money, no stakes,
 * no points, no prizes, ever (Kamby's owner is under 18; this must never become betting).
 */

export const PREDICTION_CATEGORIES = ['crypto', 'ai', 'macro', 'streamers', 'memes'] as const;
export type PredictionCategory = (typeof PREDICTION_CATEGORIES)[number];

export const PREDICTION_KINDS = ['BINARY', 'MULTI_CHOICE', 'OVER_UNDER', 'RANGES'] as const;
export type PredictionKind = (typeof PREDICTION_KINDS)[number];

export type PredictionStatus = 'ACTIVE' | 'EXPIRED' | 'RESOLVED';

export const PREDICTION_REALTIME_CHANNEL = 'kamby:predictions';

export const PREDICTION_LIMITS = {
  titleMax: 120,
  optionMax: 40,
  minOptions: 2,
  maxOptions: 4,
  /** How long someone's own poll can run, in minutes. */
  durations: [15, 60, 360, 1440],
} as const;

export interface Prediction {
  id: string;
  title: string;
  category: PredictionCategory;
  kind: PredictionKind;
  options: string[];
  /** Votes per option, same order as `options`. */
  counts: number[];
  total: number;
  status: PredictionStatus;
  expiresAt: string;
  createdAt: string;
  /** The winning option once resolved. */
  resolvedOptionIndex: number | null;
  /** Your vote (option index), when signed in. */
  myVote: number | null;
  /** The coin it's about (opens the Trade page). */
  coin: { chainIdentifier: string; tokenAddress: string; symbol: string | null } | null;
  /** Asked by a streamer while live. */
  live: { roomId: string; onAir: boolean; hostUsername: string | null } | null;
  /** Who asked, for a streamer's or user's own poll. */
  author: { username: string | null } | null;
  /** Shown for an OVER_UNDER / price poll: the line it's measured against. */
  thresholdUsd: number | null;
}

export interface PredictionsPage {
  items: Prediction[];
  nextBefore: string | null;
  stats: { votesToday: number; active: number; myVotes: number };
  /** Whether you can ask your own question (a streamer on air or a top trader). */
  canCreate: boolean;
}

export type PredictionFilter = 'all' | 'ending' | 'popular' | 'streamers' | 'mine';

export interface PredictionUpdate {
  id: string;
  counts: number[];
  total: number;
  status?: PredictionStatus;
  resolvedOptionIndex?: number | null;
}

/** Each option's share in whole percents, summing to 100 (largest remainder), or zeros. */
export function predictionShares(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((c) => (c / total) * 100);
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}
