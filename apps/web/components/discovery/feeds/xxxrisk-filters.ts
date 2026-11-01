import type { XxxRiskColumn, XxxRiskToken } from '@kamby/domain';

/**
 * The launchpad board's filters (2026-11-01, owner: "GMGN-style full panel"): one set per column
 * (New, Almost bonded, Migrated) — launchpads, the coin's socials, safety ticks, and min/max for
 * every number Kamby really has for these coins. Nothing here filters on data we don't have.
 */

export interface Range {
  min: number | null;
  max: number | null;
}

export const RANGE_KEYS = [
  'curve',
  'age',
  'liq',
  'mc',
  'vol',
  'netBuy',
  'holders',
  'buys',
  'sells',
  'top10',
  'dev',
  'snipers',
  'insiders',
  'bundlers',
  'devMigrations',
  'devLaunches',
] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const TOGGLE_KEYS = ['hasX', 'hasTelegram', 'hasWebsite', 'devUnder20', 'hideMint', 'hideFreeze', 'auditedOnly'] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];

export interface Filters {
  /** Empty = every chain. */
  chains: string[];
  /** Empty = every launchpad. */
  launchpads: string[];
  ranges: Partial<Record<RangeKey, Range>>;
  toggles: Partial<Record<ToggleKey, boolean>>;
}

export type ColumnFilters = Record<XxxRiskColumn, Filters>;

export const NO_FILTERS: Filters = { chains: [], launchpads: [], ranges: {}, toggles: {} };
export const NO_COLUMN_FILTERS: ColumnFilters = { new: NO_FILTERS, soon: NO_FILTERS, migrated: NO_FILTERS };

/** How each range is typed and shown: $ amounts accept "10k"; % and counts are plain numbers. */
export const RANGE_UNIT: Record<RangeKey, 'usd' | 'pct' | 'min' | 'count'> = {
  curve: 'pct',
  age: 'min',
  liq: 'usd',
  mc: 'usd',
  vol: 'usd',
  netBuy: 'usd',
  holders: 'count',
  buys: 'count',
  sells: 'count',
  top10: 'pct',
  dev: 'pct',
  snipers: 'pct',
  insiders: 'pct',
  bundlers: 'pct',
  devMigrations: 'count',
  devLaunches: 'count',
};

/** Exported for tests. A coin's value for a range, or null when Kamby doesn't know it. */
export function rangeValue(t: XxxRiskToken, key: RangeKey, ageS: number): number | null {
  switch (key) {
    case 'curve':
      return t.curvePct ?? null;
    case 'age':
      return ageS / 60;
    case 'liq':
      return t.liquidityUsd;
    case 'mc':
      return t.marketCapUsd;
    case 'vol':
      return t.volume5mUsd;
    case 'netBuy':
      return t.netBuy5mUsd ?? null;
    case 'holders':
      return t.holders ?? null;
    case 'buys':
      return t.buys5m ?? null;
    case 'sells':
      return t.sells5m ?? null;
    case 'top10':
      return t.topHoldersPct ?? null;
    case 'dev':
      return t.devPct ?? null;
    case 'snipers':
      return t.snipersPct ?? null;
    case 'insiders':
      return t.insidersPct ?? null;
    case 'bundlers':
      return t.bundlersPct ?? null;
    case 'devMigrations':
      return t.devMigrations ?? null;
    case 'devLaunches':
      return t.devLaunches ?? null;
  }
}

/** Exported for tests. Whether a coin passes its column's filters. An unknown number fails a set
 *  range — "at least 50 holders" never lets a coin with no holder count through. */
export function passes(t: XxxRiskToken, f: Filters, ageS: number): boolean {
  if (f.chains.length > 0 && !f.chains.includes(t.chainIdentifier ?? 'solana')) return false;
  if (f.launchpads.length > 0 && !f.launchpads.includes(t.launchpad ?? 'pump.fun')) return false;
  for (const key of RANGE_KEYS) {
    const r = f.ranges[key];
    if (!r || (r.min === null && r.max === null)) continue;
    const v = rangeValue(t, key, ageS);
    if (v === null) return false;
    if (r.min !== null && v < r.min) return false;
    if (r.max !== null && v > r.max) return false;
  }
  const on = f.toggles;
  if (on.hasX && !t.socials?.twitter) return false;
  if (on.hasTelegram && !t.socials?.telegram) return false;
  if (on.hasWebsite && !t.socials?.website) return false;
  if (on.devUnder20 && t.riskFlags.includes('dev-holds-over-20pct')) return false;
  if (on.hideMint && t.riskFlags.includes('mintable')) return false;
  if (on.hideFreeze && t.riskFlags.includes('freezable')) return false;
  if (on.auditedOnly && t.riskFlags.includes('unverified-audit')) return false;
  return true;
}

export function activeCount(f: Filters): number {
  return (
    (f.chains.length > 0 ? 1 : 0) +
    (f.launchpads.length > 0 ? 1 : 0) +
    Object.values(f.ranges).filter((r) => r && (r.min !== null || r.max !== null)).length +
    Object.values(f.toggles).filter(Boolean).length
  );
}

/** Exported for tests. Saved views from before 2026-11-01 (one flat set) start clean. */
export function readColumnFilters(raw: unknown): ColumnFilters {
  const ok = (f: unknown): Filters =>
    f && typeof f === 'object' && Array.isArray((f as Filters).launchpads)
      ? { chains: Array.isArray((f as Filters).chains) ? (f as Filters).chains.filter((x) => typeof x === 'string') : [], launchpads: (f as Filters).launchpads.filter((x) => typeof x === 'string'), ranges: { ...(f as Filters).ranges }, toggles: { ...(f as Filters).toggles } }
      : NO_FILTERS;
  const r = (raw ?? {}) as Partial<Record<XxxRiskColumn, unknown>>;
  return { new: ok(r.new), soon: ok(r.soon), migrated: ok(r.migrated) };
}

export interface Preset {
  name: string;
  filters: ColumnFilters;
}
const PRESETS_KEY = 'kamby:xxxrisk-presets';
export const MAX_PRESETS = 8;

export function loadPresets(): Preset[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PRESETS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw.filter((p): p is Preset => typeof p?.name === 'string').map((p) => ({ name: p.name.slice(0, 32), filters: readColumnFilters(p.filters) })).slice(0, MAX_PRESETS)
      : [];
  } catch {
    return [];
  }
}

export function savePresets(list: Preset[]): void {
  try {
    window.localStorage.setItem(PRESETS_KEY, JSON.stringify(list.slice(0, MAX_PRESETS)));
  } catch {
    // remembered for this visit only
  }
}

/** A small mark for where a coin launched — on cards and in the filter's launchpad chips. */
export const LAUNCHPADS: Record<string, { mark: string; name: string; color: string }> = {
  'pump.fun': { mark: 'P', name: 'Pump.fun', color: '#5BE38F' },
  'letsbonk.fun': { mark: 'B', name: 'Bonk.fun', color: '#FF8A3D' },
  'raydium-launchlab': { mark: 'R', name: 'LaunchLab', color: '#8B9BFF' },
  'met-dbc': { mark: 'M', name: 'Meteora', color: '#F5A524' },
  Meteora: { mark: 'M', name: 'Meteora', color: '#F5A524' },
  'bags.fun': { mark: 'B', name: 'Bags', color: '#C084FC' },
  moonshot: { mark: 'M', name: 'Moonshot', color: '#F0ABFC' },
  memefun: { mark: 'M', name: 'memefun', color: '#38BDF8' },
  'boop.fun': { mark: 'B', name: 'Boop', color: '#60A5FA' },
  heaven: { mark: 'H', name: 'Heaven', color: '#FDE68A' },
  'jup-studio': { mark: 'J', name: 'Jup Studio', color: '#34D399' },
  believe: { mark: 'B', name: 'Believe', color: '#A3E635' },
  'time.fun': { mark: 'T', name: 'time.fun', color: '#FCA5A5' },
  'cooking.city': { mark: 'C', name: 'Cooking', color: '#FB923C' },
  dealr: { mark: 'D', name: 'Dealr', color: '#94A3B8' },
  moonit: { mark: 'M', name: 'Moonit', color: '#E879F9' },
  // BNB / Base / Robinhood (2026-11-01).
  'four.meme': { mark: '4', name: 'Four.meme', color: '#F3BA2F' },
  flap: { mark: 'F', name: 'Flap', color: '#D9F99D' },
  clanker: { mark: 'C', name: 'Clanker', color: '#A78BFA' },
  pons: { mark: 'P', name: 'Pons', color: '#CCFF00' },
  virtuals: { mark: 'V', name: 'Virtuals · AI', color: '#5EEAD4' },
  'uniswap-v4': { mark: 'U', name: 'Uniswap v4', color: '#FF66C4' },
  uniswap: { mark: 'U', name: 'Uniswap', color: '#FF66C4' },
  pancakeswap: { mark: 'C', name: 'PancakeSwap', color: '#38BDF8' },
  aerodrome: { mark: 'A', name: 'Aerodrome', color: '#60A5FA' },
};

/** The chains on the board, for the filter's chain chips. */
export const BOARD_CHAINS: { id: string; name: string }[] = [
  { id: 'solana', name: 'Solana' },
  { id: 'eip155:56', name: 'BNB' },
  { id: 'eip155:8453', name: 'Base' },
  { id: 'eip155:4663', name: 'Robinhood' },
];
export const launchpadInfo = (id: string) => LAUNCHPADS[id] ?? { mark: id.charAt(0).toUpperCase(), name: id, color: '#94A3B8' };
