import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';
import { prisma } from '@kamby/db';
import bs58 from 'bs58';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../config/env';
import { JUPITER_V6_PROGRAM_ID } from './gas-relayer-instruction-guard';
import { GasRelayerService } from './gas-relayer.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      solanaTradeQuote: { findUnique: jest.fn() },
      solanaTradeTransaction: { findUnique: jest.fn(), create: jest.fn() },
      wallet: { findUnique: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

const mockSimulateTransaction = jest.fn();
const mockGetFeeForMessage = jest.fn();
const mockGetAccountInfo = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetAddressLookupTable = jest.fn();

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      simulateTransaction: mockSimulateTransaction,
      getFeeForMessage: mockGetFeeForMessage,
      getAccountInfo: mockGetAccountInfo,
      sendTransaction: mockSendTransaction,
      getAddressLookupTable: mockGetAddressLookupTable,
    })),
  };
});

// Real keypairs throughout — VersionedTransaction's own signing/verification needs
// genuinely valid Ed25519 keys and signatures, not faked bytes; same discipline
// solana-topup.service.spec.ts already established.
const FEE_PAYER_KEYPAIR = Keypair.generate();
const USER_KEYPAIR = Keypair.generate();
const USER_WALLET = USER_KEYPAIR.publicKey.toBase58();
const QUOTE_ID = '11111111-1111-1111-1111-111111111111';
// Any real 32-byte base58 string works structurally as a blockhash for encoding/signing
// purposes here — this test never actually submits to a real cluster, so it doesn't need
// to be a genuine recent blockhash, just correctly shaped.
const RECENT_BLOCKHASH = Keypair.generate().publicKey.toBase58();

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SOLANA_ENABLED: true,
    SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
    SOLANA_TREASURY_USDC_ATA: 'TreasuryUsdcAtaForTestingOnly11111111111',
    SOLANA_JUPITER_PLATFORM_FEE_BPS: 50,
    SOLANA_NEW_WALLET_TOPUP_SOL: 0.01,
    SOLANA_TOPUP_FUNDING_SECRET_KEY: bs58.encode(Keypair.generate().secretKey),
    SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: bs58.encode(FEE_PAYER_KEYPAIR.secretKey),
    SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING: 3_000_000,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

// Real Jupiter route instructions always include the swap owner as a required signer — a
// transaction with no account referencing USER_KEYPAIR at all can't have the user "sign"
// it (there'd be no slot to sign into), so this fixture includes that account explicitly,
// same as a real quote's built transaction always would.
const jupiterRoute = () =>
  new TransactionInstruction({
    programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
    keys: [{ pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from([193, 32, 155, 51, 65, 214, 156, 129]),
  });

/** Builds a real, well-formed VersionedTransaction — fee payer at index 0 by construction
 *  (protocol convention, not something a test needs to assert) — optionally already signed
 *  by the user in their own required-signer slot. */
function buildTransaction(options: {
  feePayer?: PublicKey;
  instructions?: TransactionInstruction[];
  signedByUser?: boolean;
}): VersionedTransaction {
  const feePayer = options.feePayer ?? FEE_PAYER_KEYPAIR.publicKey;
  const instructions = options.instructions ?? [jupiterRoute()];
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: RECENT_BLOCKHASH,
    instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  if (options.signedByUser) tx.sign([USER_KEYPAIR]);
  return tx;
}

function toBase64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

// The default transaction `buildTransaction()` produces with no overrides — used as
// `fakeQuote()`'s default `unsignedTx` so every test that doesn't care about the new
// quote-match check (added alongside the instruction-matching fix) still passes it for
// free. `solanaTransactionMatchesQuote` compares only compiled message bytes, which never
// depend on `.sign()` calls, so this stays valid whether or not the submitted transaction
// is signed.
const CANONICAL_TX_BASE64 = toBase64(buildTransaction({ signedByUser: false }));

function fakeQuote(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: QUOTE_ID,
    userId: 'user-1',
    walletAddress: USER_WALLET,
    expiresAt: new Date(Date.now() + 60_000),
    side: 'BUY',
    inputMint: 'InputMintForTestingOnly1111111111111111111',
    outputMint: 'OutputMintForTestingOnly111111111111111111',
    inputAmount: '100000000',
    expectedOutputAmount: '5000000000',
    platformFeeAmount: '1000000',
    unsignedTx: { base64: CANONICAL_TX_BASE64 },
    ...overrides,
  };
}

/** Points the mocked quote lookup at a quote whose `unsignedTx` matches `tx` exactly — for
 *  any test that deliberately builds a non-default transaction (custom instructions, a
 *  different fee payer) and wants to exercise a check *after* the quote-match gate, not the
 *  quote-match gate itself. */
function setQuoteToMatch(tx: VersionedTransaction, overrides: Partial<Record<string, unknown>> = {}): void {
  (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ unsignedTx: { base64: toBase64(tx) }, ...overrides }) as never);
}

function fakeWallet(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    address: USER_WALLET,
    userId: 'user-1',
    verifiedAt: new Date(),
    chain: 'SOLANA',
    ...overrides,
  };
}

/** The persisted row `persistSponsoredTransaction` creates — mirrors `fakeQuote`'s fields
 *  since it's built directly from the quote, plus the fields only the persisted row has. */
function fakeTransactionRow(overrides: Partial<Record<string, unknown>> = {}) {
  const quote = fakeQuote();
  return {
    id: 'tx-1',
    userId: 'user-1',
    walletAddress: USER_WALLET,
    quoteId: QUOTE_ID,
    signature: 'real-signature',
    side: quote.side,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    inputAmount: quote.inputAmount,
    expectedOutputAmount: quote.expectedOutputAmount,
    platformFeeAmount: quote.platformFeeAmount,
    status: 'PENDING',
    failureReason: null,
    submittedAt: new Date(),
    confirmedAt: null,
    sponsoredByRelayer: true,
    relayerFeePayer: FEE_PAYER_KEYPAIR.publicKey.toBase58(),
    ...overrides,
  };
}

describe('GasRelayerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAddressLookupTable.mockResolvedValue({ value: null });
    mockSimulateTransaction.mockResolvedValue({ value: { err: null } });
    mockGetFeeForMessage.mockResolvedValue({ value: 5000 });
    mockGetAccountInfo.mockResolvedValue(null);
    mockSendTransaction.mockResolvedValue('real-signature');
    (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote() as never);
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeWallet() as never);
    // No prior transaction for this quote by default — the idempotency check at the very
    // top of submitSponsoredTransaction falls through to the real flow in every test unless
    // a specific test overrides this.
    (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.solanaTradeTransaction.create as jest.Mock).mockResolvedValue(fakeTransactionRow() as never);
  });

  function service(configOverrides: Partial<Record<string, unknown>> = {}) {
    return new GasRelayerService(fakeConfig(configOverrides), fakeLogger());
  }

  it('rejects when the relayer is not configured on this deployment (no fee-payer key)', async () => {
    const tx = buildTransaction({ signedByUser: true });
    await expect(
      service({ SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: undefined }).submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects malformed transaction bytes', async () => {
    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: 'not-real-bytes' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  describe('test-wallet rollout gate', () => {
    it('rejects a wallet not on the configured test-wallet allowlist, with the exact same message as "not configured at all"', async () => {
      const tx = buildTransaction({ signedByUser: true });
      setQuoteToMatch(tx);

      await expect(
        service({ SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: 'SomeoneElsesWallet1111111111111111111111' }).submitSponsoredTransaction({
          userId: 'user-1',
          walletAddress: USER_WALLET,
          quoteId: QUOTE_ID,
          partiallySignedTxBase64: toBase64(tx),
        }),
      ).rejects.toThrow(/not configured on this deployment/i);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('accepts a wallet that is on the configured test-wallet allowlist', async () => {
      const tx = buildTransaction({ signedByUser: true });
      setQuoteToMatch(tx);

      const result = await service({ SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: `SomeoneElsesWallet1111111111111111111111,${USER_WALLET}` }).submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      });

      expect(result.signature).toBe('real-signature');
    });

    it('imposes no restriction when the allowlist is unset — every wallet remains eligible, unchanged from before this gate existed', async () => {
      const tx = buildTransaction({ signedByUser: true });
      setQuoteToMatch(tx);

      const result = await service().submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      });

      expect(result.signature).toBe('real-signature');
    });
  });

  it('404s when the quote does not exist — never trusts the client\'s claim', async () => {
    (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(null);
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a quote that belongs to a different user', async () => {
    (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ userId: 'someone-else' }) as never);
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects an expired quote', async () => {
    (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ expiresAt: new Date(Date.now() - 1000) }) as never);
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects an unverified or differently-owned wallet', async () => {
    (mockedPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(fakeWallet({ verifiedAt: null }) as never);
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the transaction\'s fee payer is not this relayer', async () => {
    const someoneElse = Keypair.generate();
    const tx = buildTransaction({ feePayer: someoneElse.publicKey, signedByUser: false });
    tx.sign([someoneElse]);
    setQuoteToMatch(tx);

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/fee payer is not this relayer/i);
  });

  it('rejects when the user has not actually signed their own required slot yet', async () => {
    const tx = buildTransaction({ signedByUser: false });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/has not actually been signed/i);
  });

  it('rejects a transaction whose instructions fail the allowlist (e.g. no Jupiter instruction)', async () => {
    const noJupiterIx = new TransactionInstruction({
      programId: ComputeBudgetProgram.programId,
      keys: [{ pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false }],
      data: ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }).data,
    });
    const tx = buildTransaction({ instructions: [noJupiterIx], signedByUser: true });
    setQuoteToMatch(tx);

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a smuggled CloseAccount with no matching same-tx creation', async () => {
    const closeIx = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
        { pubkey: FEE_PAYER_KEYPAIR.publicKey, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]), // TokenInstruction.CloseAccount
    });
    const tx = buildTransaction({ instructions: [jupiterRoute(), closeIx], signedByUser: true });
    setQuoteToMatch(tx);

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/no matching creation/i);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it('rejects a WSOL close whose target account already existed before this transaction (the CreateIdempotent bypass)', async () => {
    const wsolAta = Keypair.generate().publicKey;
    const createIx = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: FEE_PAYER_KEYPAIR.publicKey, isSigner: true, isWritable: true },
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(SOLANA_NATIVE_MINT), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent — a no-op if wsolAta already exists
    });
    const closeIx = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: FEE_PAYER_KEYPAIR.publicKey, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    const tx = buildTransaction({ instructions: [createIx, jupiterRoute(), closeIx], signedByUser: true });
    setQuoteToMatch(tx);
    // The live check this test exists for: the guard alone can't see that wsolAta already
    // has real, unrelated funds sitting in it — only a real getAccountInfo call can.
    mockGetAccountInfo.mockResolvedValue({ lamports: 5_000_000, data: Buffer.alloc(0), owner: TOKEN_PROGRAM_ID, executable: false } as never);

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/not created fresh by this same transaction/i);
    expect(mockGetAccountInfo).toHaveBeenCalledWith(expect.any(PublicKey), 'confirmed');
    expect((mockGetAccountInfo.mock.calls[0]![0] as PublicKey).toBase58()).toBe(wsolAta.toBase58());
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it('accepts and broadcasts a genuine fresh WSOL close after its live pre-existence check passes', async () => {
    const wsolAta = Keypair.generate().publicKey;
    const createIx = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: FEE_PAYER_KEYPAIR.publicKey, isSigner: true, isWritable: true },
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(SOLANA_NATIVE_MINT), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.alloc(0), // Create
    });
    const closeIx = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: false, isWritable: true },
        { pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    const tx = buildTransaction({ instructions: [createIx, jupiterRoute(), closeIx], signedByUser: true });
    setQuoteToMatch(tx);
    mockGetAccountInfo.mockResolvedValue(null); // genuinely fresh — never existed before

    const result = await service().submitSponsoredTransaction({
      userId: 'user-1',
      walletAddress: USER_WALLET,
      quoteId: QUOTE_ID,
      partiallySignedTxBase64: toBase64(tx),
    });

    expect(result.signature).toBe('real-signature');
    expect(result.sponsoredByRelayer).toBe(true);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.solanaTradeTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sponsoredByRelayer: true, relayerFeePayer: FEE_PAYER_KEYPAIR.publicKey.toBase58() }) }),
    );
  });

  it('rejects on a failed simulation', async () => {
    mockSimulateTransaction.mockResolvedValue({ value: { err: 'InsufficientFundsForRent' } });
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/failed simulation/i);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it('rejects when the worst-case cost exceeds the configured ceiling', async () => {
    mockGetFeeForMessage.mockResolvedValue({ value: 10_000_000 }); // absurdly high, well over the 3,000,000 ceiling
    const tx = buildTransaction({ signedByUser: true });

    await expect(
      service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
    ).rejects.toThrow(/could cost more than this relayer is willing to sponsor/i);
    expect(mockSendTransaction).not.toHaveBeenCalled();
  });

  it('happy path: a real, legitimate sponsored swap is co-signed, broadcast, and persisted', async () => {
    const tx = buildTransaction({ signedByUser: true });

    const result = await service().submitSponsoredTransaction({
      userId: 'user-1',
      walletAddress: USER_WALLET,
      quoteId: QUOTE_ID,
      partiallySignedTxBase64: toBase64(tx),
    });

    expect(result.signature).toBe('real-signature');
    expect(result.sponsoredByRelayer).toBe(true);
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.solanaTradeTransaction.create).toHaveBeenCalledTimes(1);
  });

  describe('quote/transaction matching', () => {
    it('rejects a shape-valid transaction that is simply a different (but still allowlist-passing) swap than the one quoted', async () => {
      // A real attack shape the generic allowlist alone can't catch: the guard only checks
      // "exactly one allowlisted Jupiter instruction," never the quote's own specific
      // amounts/mints/fee account — so a shape-valid swap for an entirely different trade,
      // riding on the caller's own valid, unexpired quote id, would otherwise sail through.
      const differentSwap = new TransactionInstruction({
        programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
        keys: [{ pubkey: USER_KEYPAIR.publicKey, isSigner: true, isWritable: false }],
        // Different discriminator bytes than the default jupiterRoute() fixture — a
        // different swap instruction, still shape-valid, still allowlisted.
        data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      });
      const tx = buildTransaction({ instructions: [differentSwap], signedByUser: true });
      // Deliberately do NOT call setQuoteToMatch — the default fakeQuote() unsignedTx is
      // the canonical default-instruction transaction, which this tx does not match.

      await expect(
        service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
      ).rejects.toThrow(/does not match the trade you were quoted/i);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('rejects when the persisted quote has a malformed/unparseable unsignedTx', async () => {
      (mockedPrisma.solanaTradeQuote.findUnique as jest.Mock).mockResolvedValue(fakeQuote({ unsignedTx: { notBase64AtAll: true } }) as never);
      const tx = buildTransaction({ signedByUser: true });

      await expect(
        service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
      ).rejects.toThrow(/does not match the trade you were quoted/i);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('accepts a transaction whose message bytes match the quote exactly even though only the signature bytes differ', async () => {
      // Proves the match check really does ignore signatures — the same unsigned message,
      // signed here, must still match the (unsigned) persisted quote.
      const tx = buildTransaction({ signedByUser: true });
      setQuoteToMatch(buildTransaction({ signedByUser: false }));

      const result = await service().submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      });

      expect(result.signature).toBe('real-signature');
    });
  });

  describe('idempotency and persistence', () => {
    it('returns the already-persisted result for a quote that was already submitted, without re-broadcasting', async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow() as never);
      const tx = buildTransaction({ signedByUser: true });

      const result = await service().submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      });

      expect(result.signature).toBe('real-signature');
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it("rejects a retry for a quote whose already-persisted transaction belongs to someone else", async () => {
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock).mockResolvedValue(fakeTransactionRow({ userId: 'someone-else' }) as never);
      const tx = buildTransaction({ signedByUser: true });

      await expect(
        service().submitSponsoredTransaction({ userId: 'user-1', walletAddress: USER_WALLET, quoteId: QUOTE_ID, partiallySignedTxBase64: toBase64(tx) }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('recovers by re-reading on a concurrent duplicate-signature race (P2002) instead of throwing', async () => {
      const { Prisma } = jest.requireActual('@kamby/db');
      (mockedPrisma.solanaTradeTransaction.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '5.22.0' }),
      );
      (mockedPrisma.solanaTradeTransaction.findUnique as jest.Mock)
        .mockResolvedValueOnce(null) // the up-front idempotency check — no prior row yet
        .mockResolvedValueOnce(fakeTransactionRow() as never); // the post-P2002 recovery read, keyed on signature
      const tx = buildTransaction({ signedByUser: true });

      const result = await service().submitSponsoredTransaction({
        userId: 'user-1',
        walletAddress: USER_WALLET,
        quoteId: QUOTE_ID,
        partiallySignedTxBase64: toBase64(tx),
      });

      expect(result.signature).toBe('real-signature');
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });
  });
});
