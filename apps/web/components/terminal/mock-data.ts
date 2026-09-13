/**
 * Static, fixed mock data for the KambyTerminal layout preview (see PreviewBanner.tsx) —
 * deliberately NOT `Math.random()`-generated at module load: a value that differs between
 * the server render and the client's first render is a hydration mismatch, and this data
 * only exists to show layout/density anyway, not to look statistically real. Anything that
 * should visibly "stream" (DataHub's live rows) is appended client-side in a `useEffect`,
 * after hydration, where fresh randomness is safe.
 */

export interface MockToken {
  id: string;
  ticker: string;
  name: string;
  avatarInitial: string;
  avatarHue: number;
  gainPct: number;
  marketCapUsd: number;
}

export const MOCK_TRENDING_TOKENS: MockToken[] = [
  { id: '1', ticker: 'FLYBRAIN', name: 'Flybrain', avatarInitial: 'F', avatarHue: 152, gainPct: 214.6, marketCapUsd: 9_700_000 },
  { id: '2', ticker: 'BONK', name: 'Bonk', avatarInitial: 'B', avatarHue: 32, gainPct: 18.2, marketCapUsd: 1_420_000_000 },
  { id: '3', ticker: 'MEWTRUCK', name: 'Mew Truck', avatarInitial: 'M', avatarHue: 280, gainPct: 76.9, marketCapUsd: 3_100_000 },
  { id: '4', ticker: 'GIGA', name: 'Gigachad', avatarInitial: 'G', avatarHue: 205, gainPct: -12.4, marketCapUsd: 42_800_000 },
  { id: '5', ticker: 'SOLPUP', name: 'Sol Pup', avatarInitial: 'S', avatarHue: 340, gainPct: 5.1, marketCapUsd: 890_000 },
  { id: '6', ticker: 'RUGPROOF', name: 'Rugproof', avatarInitial: 'R', avatarHue: 95, gainPct: 41.3, marketCapUsd: 6_250_000 },
  { id: '7', ticker: 'ZKAT', name: 'zKat', avatarInitial: 'Z', avatarHue: 18, gainPct: -4.8, marketCapUsd: 12_100_000 },
  { id: '8', ticker: 'MOONWELL', name: 'Moonwell', avatarInitial: 'W', avatarHue: 260, gainPct: 9.7, marketCapUsd: 27_600_000 },
];

/** A typed, guaranteed-defined reference to the first trending token — `MOCK_TRENDING_TOKENS[0]`
 *  types as possibly `undefined` under strict indexed access even though this literal array
 *  obviously always has one; every default/fallback usage reaches for this instead of
 *  re-deriving the same non-null assertion in multiple places. */
export const DEFAULT_MOCK_TOKEN: MockToken = MOCK_TRENDING_TOKENS[0]!;

export interface MockCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** A fixed, hand-shaped price path — not a statistically real backtest, just enough
 *  variation to prove the chart renders candles, wicks, and a monospaced price scale. */
export const MOCK_CANDLES: MockCandle[] = (() => {
  const base = Date.UTC(2026, 8, 12, 0, 0, 0) / 1000;
  const closes = [
    1.24, 1.31, 1.28, 1.35, 1.42, 1.39, 1.51, 1.47, 1.55, 1.62, 1.58, 1.66, 1.73, 1.69, 1.77, 1.84, 1.8, 1.9, 1.86,
    1.95, 2.02, 1.97, 2.08, 2.15, 2.1, 2.2, 2.28, 2.22, 2.31, 2.4, 2.35, 2.44, 2.52, 2.47, 2.38, 2.29, 2.34, 2.42,
    2.5, 2.45,
  ];
  return closes.map((close, i) => {
    const open = closes[i - 1] ?? close * 0.98;
    const high = Math.max(open, close) * 1.015;
    const low = Math.min(open, close) * 0.985;
    return { time: base + i * 3600, open, high, low, close };
  });
})();

export type MockFeedSide = 'BUY' | 'SELL';

export interface MockFeedRow {
  id: string;
  timestamp: number;
  wallet: string;
  side: MockFeedSide;
  amountUsd: number;
  signature: string;
}

export const MOCK_TRANSACTIONS: MockFeedRow[] = [
  { id: 't1', timestamp: Date.now() - 4_000, wallet: '7xKX…q3Rp', side: 'BUY', amountUsd: 420, signature: '5UzK…9mNq' },
  { id: 't2', timestamp: Date.now() - 19_000, wallet: 'Bq2m…8fWz', side: 'SELL', amountUsd: 128, signature: '2Rtn…7hLp' },
  { id: 't3', timestamp: Date.now() - 41_000, wallet: 'Hj9c…2vXe', side: 'BUY', amountUsd: 1_050, signature: '9Fpq…3kJa' },
  { id: 't4', timestamp: Date.now() - 63_000, wallet: 'D4mR…6tYs', side: 'BUY', amountUsd: 75, signature: 'Lm3v…5qWc' },
  { id: 't5', timestamp: Date.now() - 88_000, wallet: 'Kp7w…1nBd', side: 'SELL', amountUsd: 310, signature: '6Xzt…8rVy' },
];

export interface MockHolder {
  wallet: string;
  pct: number;
  amountUsd: number;
}

export const MOCK_HOLDERS: MockHolder[] = [
  { wallet: '9mNq…4xLp', pct: 8.2, amountUsd: 795_000 },
  { wallet: '3vXe…7hRt', pct: 5.6, amountUsd: 543_000 },
  { wallet: '6tYs…2kJa', pct: 4.1, amountUsd: 398_000 },
  { wallet: '1nBd…5qWc', pct: 3.3, amountUsd: 320_000 },
  { wallet: '8rVy…9fWz', pct: 2.7, amountUsd: 262_000 },
];

export interface MockCaller {
  handle: string;
  side: MockFeedSide;
  wallet: string;
  timestamp: number;
}

export const MOCK_CALLER_ALPHA: MockCaller[] = [
  { handle: '@solwhale', side: 'BUY', wallet: '7xKX…q3Rp', timestamp: Date.now() - 30_000 },
  { handle: '@degencaller', side: 'BUY', wallet: 'Hj9c…2vXe', timestamp: Date.now() - 95_000 },
  { handle: '@alphafeed', side: 'SELL', wallet: 'Kp7w…1nBd', timestamp: Date.now() - 210_000 },
];

export interface MockPosition {
  id: string;
  ticker: string;
  entryPriceUsd: number;
  currentPriceUsd: number;
  sizeUsd: number;
}

export const MOCK_POSITIONS: MockPosition[] = [
  { id: 'p1', ticker: 'FLYBRAIN', entryPriceUsd: 1.31, currentPriceUsd: 2.45, sizeUsd: 500 },
  { id: 'p2', ticker: 'RUGPROOF', entryPriceUsd: 0.084, currentPriceUsd: 0.071, sizeUsd: 180 },
];

export function formatCompactUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

export function timeAgo(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}
