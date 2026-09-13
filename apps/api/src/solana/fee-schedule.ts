/**
 * NOT WIRED UP YET — see this file's own follow-up note. The tier boundaries and target
 * dollar amounts are locked in (2026-09-13); *how* each tier's fee is actually collected is
 * still an open decision — see docs/GAS_RELAYER_PLAN.md's sibling discussion and
 * `computeTierTargetFeeUsd`'s own doc comment for why a flat dollar target can't simply
 * become a Jupiter `platformFeeBps` value for the lower tiers.
 */

export interface FeeTier {
  /** Inclusive lower bound, in whole USD. */
  minUsd: number;
  /** Inclusive upper bound, in whole USD — `null` means uncapped (the top tier). */
  maxUsd: number | null;
  /** A fixed dollar amount, OR a proportional rate — never both; see `FeeTarget`. */
  target: FeeTarget;
}

export type FeeTarget = { kind: 'flat'; usd: number } | { kind: 'percent'; rate: number };

/** Locked in 2026-09-13. `percent` tiers use a *rate* (0.0075 = 0.75%), not basis points —
 *  converted to bps only at the point something actually calls Jupiter with it. */
export const FEE_SCHEDULE: readonly FeeTier[] = [
  { minUsd: 1, maxUsd: 5, target: { kind: 'flat', usd: 0.25 } },
  { minUsd: 6, maxUsd: 10, target: { kind: 'flat', usd: 0.35 } },
  { minUsd: 11, maxUsd: 15, target: { kind: 'flat', usd: 0.45 } },
  { minUsd: 16, maxUsd: 49, target: { kind: 'flat', usd: 0.5 } },
  { minUsd: 50, maxUsd: null, target: { kind: 'percent', rate: 0.0075 } },
];

/**
 * Resolves a trade's USD size to its fee target — a real dollar amount, never a bps value.
 * Deliberately returns `null` for anything below the lowest tier's `minUsd` (< $1) rather
 * than extrapolating a tier that doesn't exist; the caller decides what "too small to
 * trade" means, this function only ever describes tiers that were actually specified.
 */
export function resolveFeeTier(tradeSizeUsd: number): FeeTier | null {
  return FEE_SCHEDULE.find((tier) => tradeSizeUsd >= tier.minUsd && (tier.maxUsd === null || tradeSizeUsd <= tier.maxUsd)) ?? null;
}

/**
 * The exact fee this trade should charge, in USD — resolves a `flat` tier to its fixed
 * amount and a `percent` tier to `tradeSizeUsd * rate`. Returns `null` when no tier matches
 * (trade below $1), same as `resolveFeeTier`.
 *
 * What this function deliberately does NOT do: convert this dollar amount into a Jupiter
 * `platformFeeBps` value. For the four `flat` tiers, the equivalent percentage ranges from
 * 25% (a $1 trade paying $0.25) down to just over 1% (a $49 trade paying $0.50) — Jupiter's
 * platform-fee mechanism has never supported anywhere near 25%, so a `flat` tier's fee
 * cannot be collected purely by asking Jupiter for a bigger cut of the swap. See
 * docs/GAS_RELAYER_PLAN.md's sibling note on this — collecting a `flat` tier's fee for real
 * needs either a second, separate fee-transfer instruction (the mechanism the EVM flow
 * already has and Solana's launch scope deliberately skipped) or the schedule itself
 * changing shape for the lower tiers. Not decided as of this file being written.
 */
export function computeTierTargetFeeUsd(tradeSizeUsd: number): number | null {
  const tier = resolveFeeTier(tradeSizeUsd);
  if (!tier) return null;
  return tier.target.kind === 'flat' ? tier.target.usd : tradeSizeUsd * tier.target.rate;
}
