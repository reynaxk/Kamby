/**
 * Verified 2026-09-14 against the real, official Pump.fun IDL
 * (https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json) — not an
 * unverified secondary source. An earlier pass at this research trusted a popular
 * open-source SDK's account struct (`virtualSolReserves`/`realSolReserves`) that turned
 * out to be stale against the program's real, current IDL, which renamed these to
 * `virtual_quote_reserves`/`real_quote_reserves` and added creator-fee/mayhem-mode/
 * cashback/holder-reward fields as the program evolved to support non-SOL quote tokens.
 * The `Anchor event` fields this file actually decodes (see pumpfun-event-decoder.ts)
 * still expose `virtual_sol_reserves`/`real_sol_reserves` directly (kept for the
 * standard/default SOL-denominated bonding curve, which is what this integration targets
 * — see that file's own doc comment on why the newer multi-quote-token fields are
 * deliberately not decoded).
 */
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/** Anchor event discriminators — the first 8 bytes of the base64-decoded payload behind
 *  every "Program data: ..." log line, identifying which event follows. */
export const CREATE_EVENT_DISCRIMINATOR = Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]);
export const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
export const COMPLETE_EVENT_DISCRIMINATOR = Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]);

// SOLANA_NATIVE_MINT and PUMP_FUN_GRADUATION_THRESHOLD_LAMPORTS live in @kamby/domain
// (packages/domain/src/trading.ts), not here — this file's ingestion code never needs
// either (it stores raw reserve values, never computes progress-to-graduation or checks
// quote_mint); apps/api's token-trenches.service.ts is what actually consumes them, and
// sharing the one definition keeps the two processes from ever disagreeing on the number.
