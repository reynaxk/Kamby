/**
 * See docs/MARKET_DATA.md#trenches (or `token-trenches.service.ts`'s own header comment if
 * that doc section doesn't exist yet). Only `TRENDING_HOLDERS` is implemented today — the
 * other three describe a pre-liquidity bonding-curve lifecycle (Pump.fun/Four.meme-style)
 * that Kamby has no indexing pipeline for on any chain it currently supports. They're kept
 * in this enum (rather than deleted) so the API's rejection of them is a deliberate,
 * documented 501, not a silent 400 "invalid enum value."
 */
export enum TrenchesCategory {
  FRESH = 'FRESH',
  NEAR_GRADUATED = 'NEAR_GRADUATED',
  JUST_GRADUATED = 'JUST_GRADUATED',
  TRENDING_HOLDERS = 'TRENDING_HOLDERS',
}
