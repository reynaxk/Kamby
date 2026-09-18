import { VersionedTransaction } from '@solana/web3.js';

/**
 * Defensively parses a persisted `SolanaTradeQuote.unsignedTx` JSON blob (written as
 * `{ base64: string }` by both `SolanaQuoteService#createQuote` and `#createSponsoredQuote`)
 * back into the raw base64 string — `null` for anything malformed rather than trusting it
 * blindly. Should only ever fail for a corrupted row (this codebase is the only writer),
 * but `solanaTransactionMatchesQuote` below must never proceed on an assumption it hasn't
 * actually verified — same discipline `@kamby/domain`'s `parseUnsignedTx` already applies
 * for the EVM side.
 */
export function parseSolanaUnsignedTx(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const base64 = (json as Record<string, unknown>).base64;
  return typeof base64 === 'string' && base64.length > 0 ? base64 : null;
}

/**
 * The Solana analogue of `@kamby/domain`'s `transactionMatchesQuote` (EVM) — see that
 * function's own doc comment for the shared "a hash's success alone proves nothing about
 * *which* trade happened" motivation. Structurally simpler here, and strictly stronger: an
 * EVM persisted quote only remembers discrete `to`/`value`/`data` fields (there's no
 * single "the whole transaction" blob to compare), so that check re-derives and compares
 * those individually. A persisted Solana quote's `unsignedTx` is already the *entire*
 * unsigned transaction Jupiter (or, for a sponsored quote, `gas-relayer-transaction-builder`)
 * produced — every instruction, account, and program id in it — so comparing the compiled
 * message bytes directly is both simpler to write and a strictly complete check: nothing
 * about the transaction's real on-chain effect (which swap, which amounts, which fee
 * account, which mints) can differ without changing at least one byte of its compiled
 * message.
 *
 * Signatures are deliberately excluded from the comparison — `VersionedTransaction.message`
 * is exactly the signed payload, independent of who has or hasn't signed it yet, so this
 * works identically whether `actual` is unsigned, partially signed (the gas-relayer
 * co-signing flow), or fully signed (a self-paid submission).
 *
 * This is the check that closes the real gap a generic instruction allowlist
 * (`gas-relayer-instruction-guard.ts`) cannot: that guard only verifies a transaction's
 * *shape* is safe to co-sign (an allowlisted program, exactly one Jupiter instruction,
 * no smuggled rent-drain) — it was never designed to catch a transaction that's
 * shape-valid but is simply the *wrong* swap riding on someone else's (or an earlier) valid
 * quote id. `GasRelayerService#submitSponsoredTransaction` calls this before ever co-signing
 * — see that method's own comment for exactly where and why.
 */
export function solanaTransactionMatchesQuote(actual: VersionedTransaction, expectedUnsignedTxBase64: string): boolean {
  let expected: VersionedTransaction;
  try {
    expected = VersionedTransaction.deserialize(Buffer.from(expectedUnsignedTxBase64, 'base64'));
  } catch {
    return false;
  }
  return Buffer.compare(actual.message.serialize(), expected.message.serialize()) === 0;
}
