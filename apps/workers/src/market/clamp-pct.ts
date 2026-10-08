/**
 * The price_change_24h_pct columns are Decimal(12, 4): under 100,000,000. A meme coin's "change"
 * computed off a near-zero launch price can exceed that, and one such value failed the whole
 * write — on BNB it stopped pool discovery every tick (2026-10-08, "numeric field overflow").
 * Capped well inside the column; null/NaN stay null.
 */
const MAX_PCT = 99_999_999;

export function clampPct(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(-MAX_PCT, Math.min(MAX_PCT, value));
}
