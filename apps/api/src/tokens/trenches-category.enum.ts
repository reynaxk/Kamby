/**
 * See `token-trenches.service.ts`'s own header comment and docs/TRADING.md#pump-fun-trenches.
 * `FRESH`/`NEAR_GRADUATED`/`JUST_GRADUATED` describe a Pump.fun-style pre-liquidity
 * bonding-curve lifecycle, backed by real ingestion as of 2026-09-14 (see
 * apps/workers/src/pumpfun/pumpfun-ingestion.ts) — `TRENDING_HOLDERS` predates them and
 * stays on Kamby's existing EVM/Uniswap market data.
 */
export enum TrenchesCategory {
  FRESH = 'FRESH',
  NEAR_GRADUATED = 'NEAR_GRADUATED',
  JUST_GRADUATED = 'JUST_GRADUATED',
  TRENDING_HOLDERS = 'TRENDING_HOLDERS',
}
