import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createTransferInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { TokenLaunch } from '@kamby/db';
import type { PinoLogger } from 'nestjs-pino';
import { PumpFunAdapter } from './pumpfun.adapter';

const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const wallet = Keypair.generate().publicKey;
const logger = { setContext: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
const launch = { walletAddress: wallet.toBase58(), devBuyUsd: 10 } as unknown as TokenLaunch;
const metadata = { name: 'Kamby Cat', symbol: 'KCAT', description: '', imageUrl: 'https://kambesh.com/launch-assets/i', metadataUri: 'https://kambesh.com/launch-assets/l.json' };

/** A create transaction like PumpPortal's, with the mint the adapter asked for as a signer. */
function createTx(mint: PublicKey, extra: TransactionInstruction[] = []): Uint8Array {
  const pumpCreate = new TransactionInstruction({ programId: PUMP, keys: [{ pubkey: mint, isSigner: true, isWritable: true }, { pubkey: wallet, isSigner: true, isWritable: true }], data: Buffer.from([1]) });
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), pumpCreate, ...extra],
  }).compileToV0Message();
  return new VersionedTransaction(message).serialize();
}

describe('PumpFunAdapter — the create transaction it hands out', () => {
  let connection: { getBalance: jest.Mock; simulateTransaction: jest.Mock };
  let adapter: PumpFunAdapter;
  let respond: (mint: PublicKey) => Uint8Array;

  beforeEach(() => {
    connection = {
      getBalance: jest.fn().mockResolvedValue(150_000_000), // 0.15 SOL
      simulateTransaction: jest.fn().mockResolvedValue({ value: { err: null, accounts: [{ lamports: 150_000_000 - 90_000_000 }] } }),
    };
    const relayer = { relayerConnection: connection, feePayerPublicKey: Keypair.generate().publicKey.toBase58() };
    const jupiter = { getEstimatedOutputRaw: jest.fn().mockResolvedValue('66000000') }; // $10 → 0.066 SOL
    const config = { get: (key: string) => ({ SOLANA_ENABLED: true, SOLANA_RPC_URL: 'https://rpc', SOLANA_TREASURY_USDC_ATA: Keypair.generate().publicKey.toBase58() })[key] };
    adapter = new PumpFunAdapter(config as never, relayer as never, jupiter as never, logger);
    respond = (mint) => createTx(mint);
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      const mint = new PublicKey(JSON.parse(init!.body!).mint);
      const bytes = respond(mint);
      return { status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Response;
    }) as never;
  });

  it('signs a normal create with the new mint and returns its address', async () => {
    const step = await adapter.buildCreate(launch, metadata);
    const tx = VersionedTransaction.deserialize(Buffer.from(step.transactionBase64, 'base64'));
    const mintIndex = tx.message.staticAccountKeys.findIndex((k) => k.toBase58() === step.tokenAddress);
    expect(mintIndex).toBeGreaterThan(0);
    expect(tx.signatures[mintIndex]!.some((b) => b !== 0)).toBe(true);
    expect(tx.signatures[0]!.every((b) => b === 0)).toBe(true); // the creator signs it, not us
  });

  it('refuses a create that uses an unknown program', async () => {
    respond = (mint) => createTx(mint, [new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.alloc(0) })]);
    await expect(adapter.buildCreate(launch, metadata)).rejects.toThrow(/unexpected program/);
  });

  it("refuses a create that moves the creator's tokens", async () => {
    const source = Keypair.generate().publicKey;
    respond = (mint) => createTx(mint, [createTransferInstruction(source, Keypair.generate().publicKey, wallet, 1n, [], TOKEN_PROGRAM_ID)]);
    await expect(adapter.buildCreate(launch, metadata)).rejects.toThrow(/moves tokens/);
  });

  it('refuses a create that would spend more SOL than the first buy and its costs', async () => {
    connection.simulateTransaction.mockResolvedValue({ value: { err: null, accounts: [{ lamports: 1_000 }] } });
    await expect(adapter.buildCreate(launch, metadata)).rejects.toThrow(/spend more than expected/);
  });

  it('refuses a create not paid by the creator', async () => {
    respond = (mint) => {
      const message = new TransactionMessage({
        payerKey: Keypair.generate().publicKey,
        recentBlockhash: '11111111111111111111111111111111',
        instructions: [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: mint, lamports: 1 })],
      }).compileToV0Message();
      return new VersionedTransaction(message).serialize();
    };
    await expect(adapter.buildCreate(launch, metadata)).rejects.toThrow(/isn't paid by your wallet/);
  });
});
