import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { AddressLookupTableAccount, Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TokenInstruction } from '@solana/spl-token';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';
import { isAtaCreateInstruction } from './gas-relayer-instruction-guard';
import type { JupiterRawInstruction, JupiterSwapInstructionsResult } from './jupiter-quote.service';

const TOKEN_PROGRAM_IDS = new Set([TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()]);

/**
 * Assembles the raw instruction arrays `JupiterQuoteService#getSwapInstructions` returns
 * into a real, unsigned `VersionedTransaction` with the relayer as fee payer — the
 * transaction-construction half `docs/GAS_RELAYER_PLAN.md` originally described as
 * "still-undesigned." `GasRelayerService` never calls this itself (it only ever validates
 * and co-signs a transaction the client hands back); this runs earlier, in the
 * sponsored-quote flow, before the user has signed anything.
 *
 * Instruction order matches Jupiter's own real response shape (confirmed live
 * 2026-09-17, see `getSwapInstructions`'s own doc comment): compute budget, then setup
 * (ATA creation etc.), then the swap itself, then cleanup (e.g. closing a temporary
 * wrapped-SOL account) — the same order `gas-relayer-instruction-guard.ts`'s WSOL-unwrap
 * exception assumes when it looks *backward* from a close to an earlier same-list create.
 *
 * A real, verified cost leak found and closed 2026-09-18: Jupiter's real `cleanupInstruction`
 * refunds a closed temporary WSOL account's rent to the *user's* wallet, unconditionally —
 * correct for a self-paid swap (the user paid to create it, the user gets it back), but a
 * pure loss for a sponsored one, where the *relayer* paid that rent via `setupInstructions`
 * (built with `payer: relayerPubkey`, see `SolanaQuoteService#createSponsoredQuote`) yet
 * never saw it again. `redirectWsolCloseToRelayer` rewrites that one destination account
 * before compiling, so the relayer is made whole — never touching anything else about the
 * instruction, and never touching a close this function can't specifically prove is for an
 * account the relayer itself just paid to create in this same instruction list (the exact
 * same structural match `gas-relayer-instruction-guard.ts`'s own WSOL-unwrap check already
 * requires at validation time — reusing its `isAtaCreateInstruction`, not a second
 * implementation of "what counts as an ATA creation" that could drift out of sync with it).
 */
export async function buildSponsoredSwapTransaction(
  connection: Connection,
  relayerPubkey: PublicKey,
  result: JupiterSwapInstructionsResult,
): Promise<VersionedTransaction> {
  const instructions = [
    ...result.computeBudgetInstructions,
    ...result.setupInstructions,
    result.swapInstruction,
    ...(result.cleanupInstruction ? [redirectWsolCloseToRelayer(result.cleanupInstruction, result.setupInstructions, relayerPubkey)] : []),
  ].map(toTransactionInstruction);

  const lookupTableAccounts = await resolveLookupTables(connection, result.addressLookupTableAddresses);

  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: relayerPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTableAccounts);

  return new VersionedTransaction(message);
}

/**
 * Returns `cleanupInstruction` unchanged unless it is *provably* a close of a WSOL account
 * the relayer itself just paid to create earlier in `setupInstructions` — in which case it
 * returns a copy with the destination account (index 1 of `CloseAccount`'s real layout,
 * `[account, destination, authority]`, confirmed against `@solana/spl-token`'s own source
 * — see `gas-relayer-instruction-guard.ts`'s identical citation) rewritten to the relayer's
 * own pubkey instead of whatever Jupiter set it to. Deliberately conservative: anything
 * that doesn't match this exact shape (wrong program, wrong instruction, no matching
 * same-list creation, that creation's mint isn't native SOL) is left completely untouched
 * — this never redirects an account the relayer didn't itself pay to create.
 */
function redirectWsolCloseToRelayer(
  cleanup: JupiterRawInstruction,
  setupInstructions: readonly JupiterRawInstruction[],
  relayerPubkey: PublicKey,
): JupiterRawInstruction {
  if (!TOKEN_PROGRAM_IDS.has(cleanup.programId)) return cleanup;
  const data = Buffer.from(cleanup.data, 'base64');
  if (data.length !== 1 || data[0] !== TokenInstruction.CloseAccount) return cleanup;

  const target = cleanup.accounts[0]?.pubkey;
  if (!target) return cleanup;

  const matchingCreate = setupInstructions.find((ix) => {
    if (!isAtaCreateInstruction({ programId: ix.programId, data: Buffer.from(ix.data, 'base64'), accounts: ix.accounts.map((a) => a.pubkey) })) {
      return false;
    }
    return ix.accounts[1]?.pubkey === target;
  });
  if (!matchingCreate || matchingCreate.accounts[3]?.pubkey !== SOLANA_NATIVE_MINT) return cleanup;

  const accounts = cleanup.accounts.map((account, index) => (index === 1 ? { ...account, pubkey: relayerPubkey.toBase58() } : account));
  return { ...cleanup, accounts };
}

function toTransactionInstruction(ix: JupiterRawInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(ix.data, 'base64'),
  });
}

async function resolveLookupTables(connection: Connection, addresses: readonly string[]): Promise<AddressLookupTableAccount[]> {
  if (addresses.length === 0) return [];
  return Promise.all(
    addresses.map(async (address) => {
      const { value } = await connection.getAddressLookupTable(new PublicKey(address));
      if (!value) throw new Error(`Referenced address lookup table ${address} could not be resolved`);
      return value;
    }),
  );
}
