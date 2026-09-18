import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { AddressLookupTableAccount, Connection } from '@solana/web3.js';
import type { JupiterRawInstruction, JupiterSwapInstructionsResult } from './jupiter-quote.service';

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
 * Deliberately does NOT redirect `cleanupInstruction`'s close destination to the relayer,
 * even though the relayer is the one who paid to create that account via
 * `setupInstructions` (`payer: relayerPubkey`) — a real attempt at exactly that shipped and
 * was reverted the same day (2026-09-18). The temporary WSOL account a close instruction
 * targets does not only ever hold bare rent: when the trade's real output is native SOL
 * itself, Jupiter routes that SOL through this same account, so its balance at close time
 * is rent *plus* the user's actual proceeds — a structural match on "was this account
 * created by the relayer" cannot distinguish "pure rent cleanup" from "this is carrying
 * real money the user is owed" without knowing the account's live balance, which isn't
 * available at build time. Confirmed for real in production: the first sponsored trade
 * whose output was native SOL had its entire proceeds (not just ~0.0015 SOL of rent, a
 * real ~0.0088 SOL) redirected to the relayer instead of the user. See
 * docs/GAS_RELAYER_PLAN.md's own account of this for the full incident and why the rent
 * leak this was trying to fix is being left as a known, accepted cost for now rather than
 * re-attempted without a live balance check.
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
    ...(result.cleanupInstruction ? [result.cleanupInstruction] : []),
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
