/**
 * Piece 3g — the Solana gas relayer's live devnet adversarial pass. See
 * docs/GAS_RELAYER_PLAN.md's own section by this name for the full context, and this
 * file's own header comment below for what is and isn't achievable here.
 *
 * NOT wired into any build/lint/test config — a standalone, throwaway tool, run by hand,
 * once, to produce the real signature/rejection log this PR's artifact needs. Safe to
 * delete after that log is captured; nothing else in the codebase imports this file.
 *
 * Real prerequisites before running the live scenarios (see main() below):
 *   1. DATABASE_URL pointing at a real Postgres this script can write test rows into —
 *      same "run inside a container on the savingourlife_default Docker network" pattern
 *      already established this session for Prisma-on-Windows (see docker-compose.yml's
 *      own comment) — the host-direct path is broken for an unrelated reason, not this
 *      script's fault.
 *   2. The relayer devnet keypair funded with real devnet SOL — this script prints the
 *      exact `solana airdrop` command for that; it does NOT request an airdrop itself (the
 *      user asked to run that step by hand, on their own schedule).
 *   3. `pnpm --filter @kamby/db generate` already run at least once (same as any other use
 *      of the prisma client in this monorepo).
 *
 * Run with: `pnpm --filter @kamby/api exec ts-node scripts/devnet-adversarial-pass.ts`
 * (from inside the Docker container described above, so DATABASE_URL actually resolves).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction } from '@solana/spl-token';
import bs58 from 'bs58';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import type { Env } from '../src/config/env';
import { JUPITER_V6_PROGRAM_ID } from '../src/solana/gas-relayer-instruction-guard';
import { GasRelayerService } from '../src/solana/gas-relayer.service';

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const KEYPAIR_DIR = join(__dirname, '.devnet-keys'); // gitignored-by-convention throwaway dir — see note in main()
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'; // a real, deployed-on-devnet, deliberately non-allowlisted program

// --- Keypair setup — safe to run repeatedly, never touches the network for money -----------

function loadOrCreateKeypair(name: string): Keypair {
  if (!existsSync(KEYPAIR_DIR)) mkdirSync(KEYPAIR_DIR, { recursive: true });
  const path = join(KEYPAIR_DIR, `${name}.json`);
  if (existsSync(path)) {
    const secret = Uint8Array.from(JSON.parse(readFileSync(path, 'utf8')) as number[]);
    return Keypair.fromSecretKey(secret);
  }
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const relayerKeypair = loadOrCreateKeypair('relayer');
const userKeypair = loadOrCreateKeypair('test-user');

// --- Fixture builders --------------------------------------------------------------------

function fakeLogger(): PinoLogger {
  return { setContext: () => undefined, info: console.log, warn: console.warn, error: console.error } as unknown as PinoLogger;
}

function relayerConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    SOLANA_ENABLED: true,
    SOLANA_RPC_URL: DEVNET_RPC_URL,
    SOLANA_TREASURY_USDC_ATA: 'DevnetPassPlaceholderTreasuryAta11111111111', // never read by submitSponsoredTransaction
    SOLANA_JUPITER_API_KEY: 'devnet-pass-placeholder',
    SOLANA_NEW_WALLET_TOPUP_SOL: 0.01,
    SOLANA_TOPUP_FUNDING_SECRET_KEY: bs58.encode(Keypair.generate().secretKey), // never read either
    SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: bs58.encode(relayerKeypair.secretKey),
    SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING: 3_000_000,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

/** A single instruction pointed at the real Jupiter V6 program id, with deliberately
 *  garbage instruction data — see this file's header comment for exactly why this is fine
 *  for every scenario below (none of them need this instruction to actually simulate
 *  successfully; Jupiter has no devnet deployment to simulate against regardless — see the
 *  "What this script cannot prove" section below). Satisfies the guard's structural
 *  "exactly one Jupiter route instruction" check, nothing more. */
function garbageJupiterInstruction(): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(JUPITER_V6_PROGRAM_ID),
    keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
    data: Buffer.from([193, 32, 155, 51, 65, 214, 156, 129]), // a real route() discriminator, garbage payload after it
  });
}

async function buildTransaction(
  connection: Connection,
  options: { feePayer?: PublicKey; instructions: TransactionInstruction[]; signAsUser?: boolean; signAsFeePayer?: Keypair },
): Promise<VersionedTransaction> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: options.feePayer ?? relayerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: options.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  if (options.signAsUser) tx.sign([userKeypair]);
  if (options.signAsFeePayer) tx.sign([options.signAsFeePayer]);
  return tx;
}

function toBase64(tx: VersionedTransaction): string {
  return Buffer.from(tx.serialize()).toString('base64');
}

/** Seeds the one real User + Wallet row every scenario needs for ownership checks to pass
 *  — same shape `assertWalletOwnership`/`submitSponsoredTransaction`'s own re-derivation
 *  expects. Idempotent (upsert) so re-running the script doesn't collide on a unique
 *  constraint. */
async function ensureTestUserAndWallet(): Promise<string> {
  const address = userKeypair.publicKey.toBase58();
  const user = await prisma.user.upsert({
    where: { id: 'devnet-adversarial-pass-user' },
    create: { id: 'devnet-adversarial-pass-user', referralCode: 'DEVNETADVPASS2G' },
    update: {},
  });
  await prisma.wallet.upsert({
    where: { address },
    create: { address, chain: 'SOLANA', userId: user.id, verifiedAt: new Date(), firstSeenAt: new Date() },
    update: { userId: user.id, verifiedAt: new Date() },
  });
  return user.id;
}

/** Seeds a fresh SolanaTradeQuote row whose unsignedTx is exactly `expectedTx` — the
 *  quote-match check (solana-quote-match.ts) compares the submitted transaction's compiled
 *  message against exactly this. A fresh row per scenario, never reused, since the
 *  relayer's own idempotency check (keyed on quoteId) would otherwise short-circuit a
 *  second submission against the same quote. */
async function seedQuote(userId: string, expectedTx: VersionedTransaction): Promise<string> {
  const row = await prisma.solanaTradeQuote.create({
    data: {
      userId,
      walletAddress: userKeypair.publicKey.toBase58(),
      side: 'BUY',
      inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // devnet's own USDC mint, for realism only
      outputMint: SOLANA_NATIVE_MINT,
      inputAmount: '1000000',
      expectedOutputAmount: '5000000',
      minOutputAmount: '4900000',
      slippageBps: 100,
      platformFeeBps: 50,
      platformFeeAmount: '5000',
      unsignedTx: { base64: toBase64(expectedTx) },
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return row.id;
}

// --- Scenarios -----------------------------------------------------------------------------

interface ScenarioResult {
  name: string;
  expected: string;
  outcome: 'PASS' | 'FAIL';
  detail: string;
}

const results: ScenarioResult[] = [];

async function runScenario(
  name: string,
  expected: string,
  fn: () => Promise<{ ok: boolean; detail: string }>,
): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    const { ok, detail } = await fn();
    results.push({ name, expected, outcome: ok ? 'PASS' : 'FAIL', detail });
    console.log(ok ? `PASS — ${detail}` : `FAIL — ${detail}`);
  } catch (error) {
    results.push({ name, expected, outcome: 'FAIL', detail: `Threw unexpectedly: ${String(error)}` });
    console.log(`FAIL — threw unexpectedly: ${String(error)}`);
  }
}

async function main() {
  console.log('Relayer devnet pubkey:', relayerKeypair.publicKey.toBase58());
  console.log('Test-user devnet pubkey:', userKeypair.publicKey.toBase58());
  console.log('\nFund the relayer before continuing:');
  console.log(`  solana airdrop 2 ${relayerKeypair.publicKey.toBase58()} --url devnet`);
  console.log('(Devnet faucet is rate-limited per address/IP — 2 SOL is comfortably enough for every scenario below,');
  console.log(' all of which are rejected before the relayer would ever actually spend anything.)\n');

  const connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  const relayerBalance = await connection.getBalance(relayerKeypair.publicKey, 'confirmed');
  console.log(`Relayer balance: ${relayerBalance / 1e9} SOL`);
  if (relayerBalance === 0) {
    console.log('\nRelayer has 0 SOL — fund it with the command above, then re-run this script. Stopping here.');
    return;
  }

  const service = new GasRelayerService(relayerConfig(), fakeLogger());
  const userId = await ensureTestUserAndWallet();

  // 1. Fee-payer mismatch — rejected before any RPC call, before simulation.
  await runScenario('Wrong fee-payer slot', 'rejected: fee payer is not this relayer', async () => {
    const someoneElse = Keypair.generate();
    const tx = await buildTransaction(connection, {
      feePayer: someoneElse.publicKey,
      instructions: [garbageJupiterInstruction()],
      signAsFeePayer: someoneElse,
    });
    const quoteId = await seedQuote(userId, tx);
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(tx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('fee payer is not this relayer'), detail: String(error) };
    }
  });

  // 2. Unsigned user slot.
  await runScenario('Unsigned user slot', 'rejected: user has not actually signed', async () => {
    const tx = await buildTransaction(connection, { instructions: [garbageJupiterInstruction()], signAsUser: false });
    const quoteId = await seedQuote(userId, tx);
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(tx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('has not actually been signed'), detail: String(error) };
    }
  });

  // 3. Quote/transaction mismatch — the Piece 3d fix, proven live.
  await runScenario('Quote/transaction mismatch', 'rejected: does not match the trade you were quoted', async () => {
    const quotedTx = await buildTransaction(connection, { instructions: [garbageJupiterInstruction()], signAsUser: true });
    const quoteId = await seedQuote(userId, quotedTx);
    // A DIFFERENT transaction than what was quoted — same shape, different instruction data.
    const submittedTx = await buildTransaction(connection, {
      instructions: [new TransactionInstruction({ programId: new PublicKey(JUPITER_V6_PROGRAM_ID), keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }], data: Buffer.from([1, 2, 3]) })],
      signAsUser: true,
    });
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(submittedTx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('does not match the trade you were quoted'), detail: String(error) };
    }
  });

  // 4. Non-allowlisted program — the Memo program is real and deployed on devnet, and
  //    deliberately not on the relayer's allowlist.
  await runScenario('Non-allowlisted program (real Memo program)', 'rejected: not on the allowlist', async () => {
    // The Memo program's real, valid usage optionally lists signers of the memo content —
    // giving the user's own pubkey a real signer slot here (rather than keys: []) so the
    // compiled message actually has somewhere for tx.sign([userKeypair]) below to sign
    // into. Same fixture mistake already caught and fixed once this session in
    // gas-relayer.service.spec.ts's own jupiterRoute() helper — "Cannot sign with non
    // signer key" is what a keys: [] instruction produces, not a finding about the code
    // under test.
    const memoIx = new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM_ID),
      keys: [{ pubkey: userKeypair.publicKey, isSigner: true, isWritable: false }],
      data: Buffer.from('devnet adversarial pass', 'utf8'),
    });
    const tx = await buildTransaction(connection, { instructions: [memoIx], signAsUser: true });
    const quoteId = await seedQuote(userId, tx);
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(tx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('not on the allowlist'), detail: String(error) };
    }
  });

  // 5. Smuggled CloseAccount with no matching same-tx creation.
  await runScenario('Smuggled CloseAccount, no matching creation', 'rejected: no matching creation earlier in this same transaction', async () => {
    const randomAccount = Keypair.generate().publicKey;
    const closeIx = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: randomAccount, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: userKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]), // TokenInstruction.CloseAccount
    });
    const tx = await buildTransaction(connection, { instructions: [garbageJupiterInstruction(), closeIx], signAsUser: true });
    const quoteId = await seedQuote(userId, tx);
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(tx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('no matching creation'), detail: String(error) };
    }
  });

  // 6. THE marquee case — CreateIdempotent against a genuinely pre-existing devnet account,
  //    then closed. First actually creates a real WSOL ATA on devnet (a real, separate,
  //    legitimate setup transaction, signed and paid for by the test user's own wallet, not
  //    the relayer), confirms it, THEN builds the adversarial transaction that points a
  //    CreateIdempotent + Close at that already-existing account. Proves the live 6b
  //    getAccountInfo check catches what the structural guard alone cannot.
  await runScenario('CreateIdempotent bypass on a genuinely pre-existing devnet WSOL ATA', 'rejected: not created fresh by this same transaction', async () => {
    const [wsolAta] = PublicKey.findProgramAddressSync(
      [userKeypair.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), new PublicKey(SOLANA_NATIVE_MINT).toBuffer()],
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const existingInfo = await connection.getAccountInfo(wsolAta, 'confirmed');
    if (!existingInfo) {
      console.log('  (setup) creating the WSOL ATA for real on devnet first — this one real setup transaction needs the test user funded with a little devnet SOL too:');
      console.log(`  solana airdrop 1 ${userKeypair.publicKey.toBase58()} --url devnet`);
      const userBalance = await connection.getBalance(userKeypair.publicKey, 'confirmed');
      if (userBalance === 0) return { ok: false, detail: 'test user has 0 SOL — fund it with the command above, then re-run' };
      const createAtaIx = createAssociatedTokenAccountInstruction(userKeypair.publicKey, wsolAta, userKeypair.publicKey, new PublicKey(SOLANA_NATIVE_MINT));
      const setupTx = await buildTransaction(connection, { feePayer: userKeypair.publicKey, instructions: [createAtaIx], signAsFeePayer: userKeypair });
      const sig = await connection.sendTransaction(setupTx, { skipPreflight: false });
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('  (setup) real WSOL ATA created on devnet:', sig);
    }

    const createIdempotentIx = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: userKeypair.publicKey, isSigner: false, isWritable: false },
        { pubkey: new PublicKey(SOLANA_NATIVE_MINT), isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    });
    const closeIx = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: wsolAta, isSigner: false, isWritable: true },
        { pubkey: userKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: userKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    const tx = await buildTransaction(connection, { instructions: [createIdempotentIx, garbageJupiterInstruction(), closeIx], signAsUser: true });
    const quoteId = await seedQuote(userId, tx);
    try {
      await service.submitSponsoredTransaction({ userId, walletAddress: userKeypair.publicKey.toBase58(), quoteId, partiallySignedTxBase64: toBase64(tx) });
      return { ok: false, detail: 'did not throw' };
    } catch (error) {
      return { ok: String(error).includes('not created fresh by this same transaction'), detail: String(error) };
    }
  });

  // 7. Idempotency — a real, safe retry against an already-rejected quote never crashes,
  //    and (separately, not re-tested here) a retry against an already-SUCCEEDED quote
  //    would return the persisted row rather than re-broadcasting — already covered by the
  //    21 real-crypto unit tests in gas-relayer.service.spec.ts; not repeated here since it
  //    doesn't depend on live devnet RPC behavior the way the six scenarios above do.

  console.log('\n\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`[${r.outcome}] ${r.name}`);
  }
  const failed = results.filter((r) => r.outcome === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} scenarios behaved as expected.`);
  if (failed.length > 0) {
    console.log('\nFailed scenarios need investigation before this can be considered a clean pass:');
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
  }

  console.log('\n=== What this script deliberately does NOT prove ===');
  console.log('Jupiter has no devnet deployment — verified live 2026-09-17 via getAccountInfo on');
  console.log('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 against api.devnet.solana.com, which came back');
  console.log('as a plain, non-executable System-owned account, not a deployed program. That means no');
  console.log('transaction touching this relayer can ever successfully simulate on devnet today, which rules');
  console.log('out three of the plan\'s original scenarios for a REAL devnet run:');
  console.log('  - a genuine swap accepted and broadcast');
  console.log('  - a genuine same-tx WSOL close accepted');
  console.log('  - the hard balance-ceiling rejection (checked AFTER simulation in the real code)');
  console.log('All three remain covered — with real Keypair/VersionedTransaction primitives, just a mocked');
  console.log('Connection — by the 21 tests in gas-relayer.service.spec.ts. Closing this residual gap for real');
  console.log('needs either a tiny real mainnet trade, or deploying/seeding a devnet AMM Jupiter could route');
  console.log('through — both disproportionate to what this pass is for. The six scenarios above are exactly');
  console.log('the ones where live RPC behavior (real getAccountInfo results, real error shapes) could plausibly');
  console.log('diverge from what a mocked Connection returns — which is exactly what a devnet pass is for.');
}

void main().finally(() => prisma.$disconnect());
