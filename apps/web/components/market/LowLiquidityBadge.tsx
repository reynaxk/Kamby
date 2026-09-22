/**
 * Same threshold the backend actually enforces (SafetyService.assertTradable,
 * apps/api/src/trading/safety.service.ts) — a market below DISCOVERY_RANKING.minLiquidityUsd
 * is rejected server-side with "This market does not have enough tracked liquidity to trade
 * safely" the moment a trade is attempted. This badge exists so that's known *before* filling
 * out a trade form, not discovered as a failed submission. Never a fabricated risk score —
 * see TokenMetricsBar.tsx's own doc comment on that discipline.
 */
export function LowLiquidityBadge() {
  return (
    <span
      title="Tracked liquidity is below Kamby's trading threshold — trades on this market may be blocked."
      className="inline-flex items-center gap-1 rounded-full border border-down/40 bg-down/10 px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide text-down"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-down" />
      Low liquidity
    </span>
  );
}
