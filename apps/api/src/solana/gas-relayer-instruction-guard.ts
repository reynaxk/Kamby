import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenInstruction } from '@solana/spl-token';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';

/**
 * NOT WIRED UP — deliberately inert. This is the security-critical validation core of the
 * (deferred) gas-relayer, written and tested now so the design is real and reviewable, per
 * the plan locked in 2026-09-13 (see docs/GAS_RELAYER_PLAN.md). Nothing imports
 * `GasRelayerService` from any NestJS module, no route exposes it, and no env var this
 * needs is required by the shared `ValidatedEnvSchema` — today's deploy validation is
 * completely unaffected by this file's existence.
 *
 * Takes an already-resolved instruction list (program id + raw data only — see
 * `ResolvedInstruction`) rather than a raw `VersionedTransaction`, deliberately: resolving
 * a v0 transaction's actual account keys (address lookup tables included) needs a live RPC
 * connection, which would make this module impossible to unit test without a real network.
 * `GasRelayerService` owns that I/O and hands this pure function a plain, already-resolved
 * list — everything below is synchronous, dependency-free, and adversarially testable with
 * hand-built fixtures (see the accompanying .spec.ts).
 *
 * Jupiter's own program has shipped at two addresses in production — both are trusted
 * outputs of the same code, so both are allowlisted (confirmed 2026-09-13 against Jupiter's
 * own Solscan listing and community-verified references, not assumed from memory):
 * `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` (primary v6 deployment) and
 * `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` (secondary deployment some integrators use).
 */
export const JUPITER_V6_PROGRAM_ID = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const JUPITER_V6_PROGRAM_ID_SECONDARY = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

const JUPITER_PROGRAM_IDS = new Set([JUPITER_V6_PROGRAM_ID, JUPITER_V6_PROGRAM_ID_SECONDARY]);

/**
 * Every program id this relayer will ever co-sign a transaction that touches — nothing
 * else, ever. Adding a program here is a real security decision, not a config tweak:
 * anything on this list can move the fee-payer's lamports via whatever instructions that
 * program defines, constrained only by the specific instruction-level checks below (which
 * currently only exist for the Token program's `CloseAccount`).
 */
const ALLOWED_PROGRAM_IDS = new Set([
  SystemProgram.programId.toBase58(),
  ComputeBudgetProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  ...JUPITER_PROGRAM_IDS,
]);

export interface ResolvedInstruction {
  /** Base58 program id — already resolved past any address-lookup-table indirection by
   *  the caller (see this file's own doc comment). */
  programId: string;
  data: Uint8Array;
  /** Base58 pubkeys for every account this instruction references, in order — already
   *  resolved past ALT indirection by the caller. Needed to cross-reference a
   *  `CloseAccount` against an earlier same-transaction ATA creation (see the WSOL-unwrap
   *  exception below) — added alongside that fix; every existing allowlist/Jupiter-count
   *  check above never reads this. */
  accounts: readonly string[];
}

export type GuardResult =
  | {
      ok: true;
      /** Base58 addresses of every account a *permitted* same-transaction WSOL close
       *  targets. A pure, synchronous function can confirm the close is paired with a
       *  same-list creation and targets the wrapped-SOL mint — it cannot confirm that
       *  target account didn't already exist *before* this transaction (the
       *  `CreateIdempotent` bypass — see this file's own doc comment on why that matters).
       *  `GasRelayerService` must run a live `getAccountInfo` pre-existence check against
       *  every address here before treating this transaction as genuinely safe to sign.
       *  Empty when no close was permitted, which is the common case — most quoted swaps
       *  don't unwrap SOL at all. */
      wsolClosesRequiringFreshnessCheck: readonly string[];
    }
  | { ok: false; reason: string };

const ATA_PROGRAM_ID = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const TOKEN_PROGRAM_IDS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);
/** A same-tx SOL-in/SOL-out wrap-then-unwrap pair is the real shape a genuine swap
 *  produces; unconditional counts beyond that stay suspicious even once individually
 *  matched to a legitimate creation. */
const MAX_ALLOWED_WSOL_CLOSES = 2;

/** True for the ATA program's `Create` (empty data) or `CreateIdempotent` (single byte
 *  `1`) instructions — confirmed against `@solana/spl-token`'s own source
 *  (`instructions/associatedTokenAccount.ts`) before coding this, not assumed from memory.
 *  Deliberately excludes `RecoverNested` (single byte `2`, same program id) — a different
 *  operation this allowlist has no reason to ever ride along with. Account layout, also
 *  confirmed against that same source: `[payer, associatedToken, owner, mint, ...]` — index
 *  1 is the account actually being created, index 3 is its mint.
 *
 *  Exported for `gas-relayer-transaction-builder.ts`'s own use — the same structural check,
 *  run in the opposite direction (assigning a fresh WSOL close's rent refund forward to the
 *  relayer at build time, rather than verifying a close backward at validation time). Kept
 *  as one shared implementation rather than two, so the two call sites can never drift on
 *  what counts as a real ATA creation. */
export function isAtaCreateInstruction(ix: ResolvedInstruction): boolean {
  return ix.programId === ATA_PROGRAM_ID && (ix.data.length === 0 || (ix.data.length === 1 && ix.data[0] === 1));
}

/**
 * The named, specific mitigation for ATA rent-draining — confirmed as a real, current risk
 * directly by Privy's own docs (2026-09-13): on Solana, an Associated Token Account's rent
 * refund on close goes to the account *owner*, not the transaction's fee payer. A malicious
 * client could smuggle a `CloseAccount` instruction into an otherwise-legitimate-looking
 * swap transaction, have the relayer pay to create a throwaway ATA as part of "the swap,"
 * then close it and pocket the rent — repeated many times, this drains the sponsor wallet
 * for free.
 *
 * Real collision found before this was ever wired up: Jupiter's own swaps routinely close a
 * temporary wrapped-SOL account as ordinary cleanup after unwrapping SOL — the exact same
 * instruction shape as the attack above. Unconditional rejection (this function's original
 * form) would have broken legitimate swaps, not just attacks. The fix: allow a close only
 * when *all* of the following hold, checked against `priorInstructions` (this transaction's
 * own instruction list up to this point — a close can only ever legitimately reference a
 * creation earlier in the same list, never a later one):
 *   1. Its target account (`accounts[0]`, per `@solana/spl-token`'s own `CloseAccount`
 *      layout, confirmed before coding this) matches the `associatedToken` an earlier
 *      `Create`/`CreateIdempotent` instruction in this same list targeted.
 *   2. That creating instruction's own mint account (`accounts[3]`, same source) equals
 *      the wrapped-SOL mint (`SOLANA_NATIVE_MINT`) — the only mint this relayer has any
 *      reason to ever see wrapped/unwrapped mid-swap.
 *   3. Its destination (`accounts[1]`) is one of `acceptableCloseDestinations` — the fee
 *      payer or the user's own wallet (Jupiter's real unwrap sends the refund to the
 *      account's owner, the user, not the fee payer) — defense in depth, never an
 *      arbitrary third address, on top of the structural checks above.
 * `CreateIdempotent`'s own no-op-if-already-exists semantics mean checks 1-3 alone are
 * still not sufficient — an attacker could point a `CreateIdempotent` at a *pre-existing*
 * WSOL ATA that already holds real, unrelated value, satisfying every check above without
 * the account actually being fresh. That needs a live `getAccountInfo` call this
 * synchronous function cannot make — see `wsolClosesRequiringFreshnessCheck` on the result
 * type, which `GasRelayerService` must check before broadcasting.
 *
 * Cost accounting still holds even with closes now sometimes permitted: the existing
 * worst-case ceiling in `GasRelayerService` already prices every ATA-create instruction's
 * rent as a sunk cost this relayer never expects back, regardless of whether a close
 * follows. Permitting a provably-fresh WSOL close is strictly better than that existing
 * worst case, never worse.
 */
function checkCloseAccount(
  ix: ResolvedInstruction,
  priorInstructions: readonly ResolvedInstruction[],
  acceptableCloseDestinations: ReadonlySet<string>,
): { allowed: true; freshnessCheckTarget: string } | { allowed: false; reason: string } {
  const [target, destination] = ix.accounts;
  if (!target || !destination) {
    return { allowed: false, reason: 'Instruction closes a token account with an unresolvable account list' };
  }
  if (!acceptableCloseDestinations.has(destination)) {
    return {
      allowed: false,
      reason: 'Instruction closes a token account to a destination that is neither the fee payer nor the caller\'s own wallet',
    };
  }
  const matchingCreate = priorInstructions.find((prior) => isAtaCreateInstruction(prior) && prior.accounts[1] === target);
  if (!matchingCreate) {
    return { allowed: false, reason: 'Instruction closes a token account with no matching creation earlier in this same transaction' };
  }
  if (matchingCreate.accounts[3] !== SOLANA_NATIVE_MINT) {
    return { allowed: false, reason: 'Instruction closes a token account for a mint other than wrapped SOL' };
  }
  return { allowed: true, freshnessCheckTarget: target };
}

/**
 * Validates the full instruction set of a transaction this relayer is about to co-sign as
 * fee payer. Deliberately conservative: anything not explicitly recognized as safe is
 * rejected, never allowed through on the assumption it's probably fine.
 */
export function validateRelayerInstructions(
  instructions: readonly ResolvedInstruction[],
  context: { acceptableCloseDestinations: readonly string[] },
): GuardResult {
  if (instructions.length === 0) {
    return { ok: false, reason: 'Transaction has no instructions' };
  }

  const acceptableCloseDestinations = new Set(context.acceptableCloseDestinations);
  const wsolClosesRequiringFreshnessCheck: string[] = [];
  let jupiterRouteCount = 0;

  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i]!;
    if (!ALLOWED_PROGRAM_IDS.has(ix.programId)) {
      return { ok: false, reason: `Instruction targets a program not on the allowlist: ${ix.programId}` };
    }

    const isTokenProgram = TOKEN_PROGRAM_IDS.has(ix.programId);
    if (isTokenProgram && ix.data[0] === TokenInstruction.CloseAccount) {
      if (wsolClosesRequiringFreshnessCheck.length >= MAX_ALLOWED_WSOL_CLOSES) {
        return { ok: false, reason: `More than ${MAX_ALLOWED_WSOL_CLOSES} token-account closes in one transaction` };
      }
      const result = checkCloseAccount(ix, instructions.slice(0, i), acceptableCloseDestinations);
      if (!result.allowed) return { ok: false, reason: result.reason };
      wsolClosesRequiringFreshnessCheck.push(result.freshnessCheckTarget);
    }

    if (JUPITER_PROGRAM_IDS.has(ix.programId)) jupiterRouteCount += 1;
  }

  // Not "at least one" — exactly one. This relayer exists to sponsor gas for one specific,
  // already-quoted Jupiter swap, never a bundle of several; two Jupiter instructions in one
  // transaction isn't a shape any real quote from this backend ever produces, so it's
  // treated as suspicious rather than "efficient."
  if (jupiterRouteCount === 0) {
    return { ok: false, reason: 'No Jupiter swap instruction found — this relayer only sponsors a Jupiter swap it already quoted' };
  }
  if (jupiterRouteCount > 1) {
    return { ok: false, reason: `Expected exactly one Jupiter route instruction, found ${jupiterRouteCount}` };
  }

  return { ok: true, wsolClosesRequiringFreshnessCheck };
}
