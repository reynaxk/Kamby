import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, TokenInstruction } from '@solana/spl-token';

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
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * The named, specific mitigation for ATA rent-draining — confirmed as a real, current risk
 * directly by Privy's own docs (2026-09-13): on Solana, an Associated Token Account's rent
 * refund on close goes to the account *owner*, not the transaction's fee payer. A malicious
 * client could smuggle a `CloseAccount` instruction into an otherwise-legitimate-looking
 * swap transaction, have the relayer pay to create a throwaway ATA as part of "the swap,"
 * then close it and pocket the rent — repeated many times, this drains the sponsor wallet
 * for free. Rejected outright, unconditionally, regardless of which account it targets or
 * what else is in the transaction — there is no legitimate reason a Jupiter swap this
 * relayer already quoted server-side would ever need to close a token account.
 */
function rejectsCloseAccount(ix: ResolvedInstruction): string | null {
  const isTokenProgram = ix.programId === TOKEN_PROGRAM_ID.toBase58() || ix.programId === TOKEN_2022_PROGRAM_ID.toBase58();
  if (!isTokenProgram) return null;
  const discriminator = ix.data[0];
  if (discriminator === TokenInstruction.CloseAccount) {
    return 'Instruction closes a token account — rejected outright regardless of context (ATA rent-drain protection)';
  }
  return null;
}

/**
 * Validates the full instruction set of a transaction this relayer is about to co-sign as
 * fee payer. Deliberately conservative: anything not explicitly recognized as safe is
 * rejected, never allowed through on the assumption it's probably fine.
 */
export function validateRelayerInstructions(instructions: readonly ResolvedInstruction[]): GuardResult {
  if (instructions.length === 0) {
    return { ok: false, reason: 'Transaction has no instructions' };
  }

  let jupiterRouteCount = 0;
  for (const ix of instructions) {
    if (!ALLOWED_PROGRAM_IDS.has(ix.programId)) {
      return { ok: false, reason: `Instruction targets a program not on the allowlist: ${ix.programId}` };
    }

    const closeAccountReason = rejectsCloseAccount(ix);
    if (closeAccountReason) return { ok: false, reason: closeAccountReason };

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

  return { ok: true };
}
