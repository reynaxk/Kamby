import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { parseSolanaUnsignedTx, solanaTransactionMatchesQuote } from './solana-quote-match';

const FEE_PAYER = Keypair.generate();
const USER = Keypair.generate();
const RECENT_BLOCKHASH = Keypair.generate().publicKey.toBase58();

function buildTx(options: { feePayer?: PublicKey; instructions?: TransactionInstruction[] }): VersionedTransaction {
  const instructions = options.instructions ?? [SystemProgram.transfer({ fromPubkey: USER.publicKey, toPubkey: FEE_PAYER.publicKey, lamports: 1000 })];
  const message = new TransactionMessage({
    payerKey: options.feePayer ?? FEE_PAYER.publicKey,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions,
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function toBase64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

describe('parseSolanaUnsignedTx', () => {
  it('extracts the base64 string from a well-formed { base64 } blob', () => {
    expect(parseSolanaUnsignedTx({ base64: 'abc123' })).toBe('abc123');
  });

  it.each([[null], [undefined], ['a string, not an object'], [42], [{}], [{ base64: 42 }], [{ base64: '' }], [{ notBase64: 'abc' }]])(
    'returns null for malformed input: %p',
    (input) => {
      expect(parseSolanaUnsignedTx(input)).toBeNull();
    },
  );
});

describe('solanaTransactionMatchesQuote', () => {
  it('matches when the actual transaction is byte-for-byte the one quoted', () => {
    const tx = buildTx({});
    expect(solanaTransactionMatchesQuote(tx, toBase64(tx))).toBe(true);
  });

  it('matches regardless of whether the actual transaction has been signed — only the message is compared', () => {
    const unsigned = buildTx({});
    const signed = buildTx({});
    signed.sign([USER]);
    expect(solanaTransactionMatchesQuote(signed, toBase64(unsigned))).toBe(true);
  });

  it('rejects a transaction with different instructions than the one quoted', () => {
    const quoted = buildTx({});
    const actual = buildTx({ instructions: [SystemProgram.transfer({ fromPubkey: USER.publicKey, toPubkey: FEE_PAYER.publicKey, lamports: 999_999 })] });
    expect(solanaTransactionMatchesQuote(actual, toBase64(quoted))).toBe(false);
  });

  it('rejects a transaction with a different fee payer than the one quoted', () => {
    const quoted = buildTx({});
    const someoneElse = Keypair.generate();
    const actual = buildTx({ feePayer: someoneElse.publicKey });
    expect(solanaTransactionMatchesQuote(actual, toBase64(quoted))).toBe(false);
  });

  it('returns false, never throws, for a malformed expected base64 string', () => {
    const tx = buildTx({});
    expect(solanaTransactionMatchesQuote(tx, 'not-real-base64-transaction-bytes')).toBe(false);
  });

  it('returns false for a well-formed base64 string that does not decode to a valid transaction', () => {
    const tx = buildTx({});
    expect(solanaTransactionMatchesQuote(tx, Buffer.from('hello world').toString('base64'))).toBe(false);
  });
});
