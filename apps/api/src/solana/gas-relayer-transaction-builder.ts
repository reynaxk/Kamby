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
 * ## The WSOL rent leak, and why the fix needs `outputMint`
 *
 * The relayer pays real rent to create a temporary WSOL account whenever a sponsored
 * route touches native SOL (`setupInstructions` are built with `payer: relayerPubkey`),
 * but Jupiter's own `cleanupInstruction` unconditionally refunds that account's balance to
 * the *user's* wallet on close — a real, measured cost of ~0.0015 SOL per trade (confirmed
 * live in production 2026-09-18).
 *
 * A first attempt at recovering this (2026-09-18, reverted the same day) redirected every
 * structurally-matched WSOL close to the relayer, on the theory that the relayer paid to
 * create the account so the relayer should get the refund. That is true for *rent*, but
 * the same WSOL account is not only ever a rent-bearing shell: when the trade's real
 * output is native SOL itself, Jupiter routes the swap's actual proceeds *through* that
 * same account before closing it — its balance at close time is rent *plus* the money the
 * user is owed. The first attempt could not tell those two cases apart from instruction
 * shape alone, and on the very next real trade whose output was SOL, it sent the user's
 * real ~0.0088 SOL proceeds to the relayer instead of the user.
 *
 * The fix redirects rent only when it can prove, structurally, that this can never be the
 * output-delivery case: `outputMint !== SOLANA_NATIVE_MINT`. When the trade's real output
 * is some other token (or USDC), the user's actual proceeds are delivered through *that*
 * token's own account, never through WSOL — any WSOL account touched along the way is
 * provably an internal wrap-then-fully-consume artifact (confirmed live: the WSOL account
 * in a real SELL transaction held *exactly* its rent-exemption amount, nothing more, both
 * times observed). When the output *is* native SOL, the redirect is skipped entirely and
 * Jupiter's own default (refund to the user) is left untouched — the rent leak stays, but
 * nothing is ever misdirected. Kamby's Solana panel currently only trades USDC ⟷ SOL, so
 * in practice this means: SELL trades get the optimization, BUY trades don't, until a
 * future trade pair makes the picture more nuanced than "which side is SOL."
 */
export async function buildSponsoredSwapTransaction(
  connection: Connection,
  relayerPubkey: PublicKey,
  outputMint: string,
  result: JupiterSwapInstructionsResult,
): Promise<VersionedTransaction> {
  const cleanup =
    result.cleanupInstruction && outputMint !== SOLANA_NATIVE_MINT
      ? redirectWsolCloseToRelayer(result.cleanupInstruction, result.setupInstructions, relayerPubkey)
      : result.cleanupInstruction;

  const instructions = [...result.computeBudgetInstructions, ...result.setupInstructions, result.swapInstruction, ...(cleanup ? [cleanup] : [])].map(
    toTransactionInstruction,
  );

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
 * same-list creation, that creation's mint isn't native SOL) is left completely untouched.
 *
 * Only ever called when the caller (`buildSponsoredSwapTransaction`, above) has already
 * confirmed `outputMint !== SOLANA_NATIVE_MINT` — this function's own structural check
 * alone is *not* sufficient to rule out redirecting real trade proceeds (that was the
 * 2026-09-18 incident); the outputMint gate is what actually makes this safe, not this
 * function in isolation.
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
