import { Keypair, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import type { Connection, PublicKey } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_NATIVE_MINT, SOLANA_USDC_MINT } from '@kamby/domain';
import { buildSponsoredSwapTransaction } from './gas-relayer-transaction-builder';
import type { JupiterRawInstruction, JupiterSwapInstructionsResult } from './jupiter-quote.service';

const RELAYER = Keypair.generate();
const USER = Keypair.generate();
const OTHER_MINT = Keypair.generate().publicKey.toBase58();

function fakeConnection(): Connection {
  return {
    getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58() }),
    getAddressLookupTable: jest.fn(),
  } as unknown as Connection;
}

function ix(overrides: Partial<JupiterRawInstruction> = {}): JupiterRawInstruction {
  const transfer = SystemProgram.transfer({ fromPubkey: USER.publicKey, toPubkey: RELAYER.publicKey, lamports: 1 });
  return {
    programId: transfer.programId.toBase58(),
    accounts: transfer.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: transfer.data.toString('base64'),
    ...overrides,
  };
}

/** Real account layout: [payer, associatedToken, owner, mint, systemProgram, tokenProgram] —
 *  same as gas-relayer-instruction-guard.spec.ts's own verified helper. */
function ataCreate(options: { target: string; mint: string; payer?: PublicKey; idempotent?: boolean }): JupiterRawInstruction {
  return ix({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    accounts: [
      { pubkey: (options.payer ?? RELAYER.publicKey).toBase58(), isSigner: true, isWritable: true },
      { pubkey: options.target, isSigner: false, isWritable: true },
      { pubkey: USER.publicKey.toBase58(), isSigner: false, isWritable: false },
      { pubkey: options.mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId.toBase58(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID.toBase58(), isSigner: false, isWritable: false },
    ],
    data: Buffer.from(options.idempotent ? [1] : []).toString('base64'),
  });
}

/** Real account layout: [account, destination, authority]. */
function closeAccount(options: { target: string; destination: string }): JupiterRawInstruction {
  return ix({
    programId: TOKEN_PROGRAM_ID.toBase58(),
    accounts: [
      { pubkey: options.target, isSigner: false, isWritable: true },
      { pubkey: options.destination, isSigner: false, isWritable: true },
      { pubkey: USER.publicKey.toBase58(), isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]).toString('base64'), // TokenInstruction.CloseAccount
  });
}

function fakeResult(overrides: Partial<JupiterSwapInstructionsResult> = {}): JupiterSwapInstructionsResult {
  return {
    inputAmountRaw: '1000000',
    outputAmountRaw: '2000000',
    minOutputAmountRaw: '1900000',
    priceImpactBps: 10,
    platformFeeAmountRaw: '5000',
    computeBudgetInstructions: [],
    setupInstructions: [],
    swapInstruction: ix(),
    cleanupInstruction: null,
    addressLookupTableAddresses: [],
    ...overrides,
  };
}

/** Decodes the built transaction's cleanup (last) instruction's destination account back
 *  out, for real — proving what actually ended up in the compiled message, not just what
 *  was passed in. */
function decodeCloseDestination(tx: VersionedTransaction): string {
  const keys = tx.message.staticAccountKeys;
  const lastIx = tx.message.compiledInstructions[tx.message.compiledInstructions.length - 1]!;
  return keys[lastIx.accountKeyIndexes[1]!]!.toBase58();
}

/** A fresh WSOL create+close pair — the shape both the safe (SELL) and unsafe (BUY) cases
 *  share; only `outputMint` passed to buildSponsoredSwapTransaction distinguishes them. */
function wsolCreateAndClose(): { setupInstructions: JupiterRawInstruction[]; cleanupInstruction: JupiterRawInstruction } {
  const wsolAta = Keypair.generate().publicKey.toBase58();
  return {
    setupInstructions: [ataCreate({ target: wsolAta, mint: SOLANA_NATIVE_MINT })],
    cleanupInstruction: closeAccount({ target: wsolAta, destination: USER.publicKey.toBase58() }),
  };
}

describe('buildSponsoredSwapTransaction', () => {
  it('builds a real VersionedTransaction with the relayer as fee payer (account index 0)', async () => {
    const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, fakeResult());
    expect(tx).toBeInstanceOf(VersionedTransaction);
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(RELAYER.publicKey.toBase58());
  });

  it('never crashes and includes no cleanup instruction when cleanupInstruction is null', async () => {
    const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, fakeResult({ cleanupInstruction: null }));
    expect(tx.message.compiledInstructions).toHaveLength(1);
  });

  describe('the regression this exists to prevent: outputMint === SOLANA_NATIVE_MINT (the trade\'s real output is SOL itself)', () => {
    it('never redirects the close — even one that structurally matches a relayer-paid WSOL creation — because that account may carry the user\'s real proceeds', async () => {
      const { setupInstructions, cleanupInstruction } = wsolCreateAndClose();
      const result = fakeResult({ setupInstructions, cleanupInstruction });

      // outputMint is native SOL — the exact scenario that misdirected a real user's ~0.0088
      // SOL proceeds in production on 2026-09-18 when this gate did not exist yet.
      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_NATIVE_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(USER.publicKey.toBase58());
    });
  });

  describe('the safe case: outputMint !== SOLANA_NATIVE_MINT (the trade\'s real output is delivered through a different token account entirely)', () => {
    it('redirects a fresh WSOL close (matched to an earlier Create) to the relayer', async () => {
      const { setupInstructions, cleanupInstruction } = wsolCreateAndClose();
      const result = fakeResult({ setupInstructions, cleanupInstruction });

      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(RELAYER.publicKey.toBase58());
    });

    it('redirects a fresh WSOL close matched to a CreateIdempotent the same way', async () => {
      const wsolAta = Keypair.generate().publicKey.toBase58();
      const result = fakeResult({
        setupInstructions: [ataCreate({ target: wsolAta, mint: SOLANA_NATIVE_MINT, idempotent: true })],
        cleanupInstruction: closeAccount({ target: wsolAta, destination: USER.publicKey.toBase58() }),
      });

      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(RELAYER.publicKey.toBase58());
    });

    it('leaves a close with no matching same-list creation untouched — never redirects an account it cannot prove the relayer paid for', async () => {
      const someAccount = Keypair.generate().publicKey.toBase58();
      const result = fakeResult({
        setupInstructions: [],
        cleanupInstruction: closeAccount({ target: someAccount, destination: USER.publicKey.toBase58() }),
      });

      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(USER.publicKey.toBase58());
    });

    it('leaves a close of a non-SOL mint untouched, even with a matching same-list creation', async () => {
      const someAta = Keypair.generate().publicKey.toBase58();
      const result = fakeResult({
        setupInstructions: [ataCreate({ target: someAta, mint: OTHER_MINT })],
        cleanupInstruction: closeAccount({ target: someAta, destination: USER.publicKey.toBase58() }),
      });

      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(USER.publicKey.toBase58());
    });

    it('leaves a non-CloseAccount cleanup instruction completely untouched', async () => {
      // A plain SystemProgram transfer to a third party — not a CloseAccount at all, and its
      // destination (index 1) is deliberately neither the relayer nor the user, so a
      // (wrong) redirect would be unambiguously detectable.
      const thirdParty = Keypair.generate();
      const plainTransfer = SystemProgram.transfer({ fromPubkey: USER.publicKey, toPubkey: thirdParty.publicKey, lamports: 1 });
      const result = fakeResult({
        cleanupInstruction: {
          programId: plainTransfer.programId.toBase58(),
          accounts: plainTransfer.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })),
          data: plainTransfer.data.toString('base64'),
        },
      });

      const tx = await buildSponsoredSwapTransaction(fakeConnection(), RELAYER.publicKey, SOLANA_USDC_MINT, result);

      expect(decodeCloseDestination(tx)).toBe(thirdParty.publicKey.toBase58());
    });
  });
});
