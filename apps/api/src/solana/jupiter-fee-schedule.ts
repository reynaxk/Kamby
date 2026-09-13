/**
 * Locked in 2026-09-13, superseding the flat-dollar tiers in `fee-schedule.ts` for
 * Jupiter-routed swaps specifically: Jupiter's `platformFeeBps` mechanism can only take a
 * percentage of the swap, and the flat-dollar tiers implied 5-25% effective rates at the
 * low end — far beyond anything Jupiter's fee mechanism has ever supported. Two tiers,
 * both comfortably real percentages:
 *
 * - Under $50: 100 bps (1.00%) — covers small-trade overhead without a second,
 *   separate fee-transfer instruction.
 * - $50 and up: 75 bps (0.75%), uncapped.
 *
 * `fee-schedule.ts`'s flat-dollar tiers are NOT dead code — they're kept for a possible
 * future direct (non-Jupiter) execution path that crafts its own transactions and could
 * apply a literal dollar fee via its own instruction, the way this Jupiter-routed flow
 * cannot. Not built; see docs/GAS_RELAYER_PLAN.md's sibling notes on scope.
 */
export function resolveJupiterPlatformFeeBps(tradeSizeUsd: number): number {
  return tradeSizeUsd >= 50 ? 75 : 100;
}
