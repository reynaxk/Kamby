import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TokenLaunch } from '@kamby/db';
import { SOLANA_NATIVE_MINT, SOLANA_USDC_MINT, type LaunchProof } from '@kamby/domain';
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, VersionedTransaction, type Connection } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../../config/env';
import { GasRelayerService, rebroadcastUntilLanded } from '../../solana/gas-relayer.service';
import { buildSponsoredSwapTransaction } from '../../solana/gas-relayer-transaction-builder';
import { JupiterQuoteService } from '../../solana/jupiter-quote.service';
import { setupFeeInstruction } from '../../solana/new-coin-setup-fee';
import { solanaTransactionMatchesQuote } from '../../solana/solana-quote-match';
import type { LaunchAdapter, LaunchMetadata, PreparedStep } from './launch-adapter';

const PUMPPORTAL_TRADE_LOCAL_URL = 'https://pumpportal.fun/api/trade-local';
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const METAPLEX_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
/** What a create costs besides the first buy: its accounts' rent (~0.02 SOL), PumpPortal's 0.5%,
 *  network and priority fees — kept back from the SOL the funding step buys. */
const CREATE_RESERVE_LAMPORTS = 30_000_000;
/** Funding buys a little more SOL than the target, so price movement can't leave it short. */
const FUNDING_BUFFER = 1.03;
/** The smallest swap the funding step does (Jupiter needs a real route; also covers the reserve). */
const MIN_FUNDING_USDC_RAW = 1_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000;
/** Programs a Pump.fun create transaction may use. Anything else is refused, never signed. */
const CREATE_PROGRAMS = new Set([
  ComputeBudgetProgram.programId.toBase58(),
  SystemProgram.programId.toBase58(),
  TOKEN_PROGRAM_ID.toBase58(),
  TOKEN_2022_PROGRAM_ID.toBase58(),
  ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
  PUMP_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  METAPLEX_METADATA_PROGRAM_ID,
]);
/** SPL token instructions that move or hand over tokens the creator already holds. */
const TOKEN_MOVING_INSTRUCTIONS = new Set([3, 4, 6, 9, 12, 13]);

/**
 * Pump.fun on Solana (Kamby's LaunchPad, 2026-10-14). Funding: a relayer-sponsored Jupiter swap of
 * the creator's USDC for the SOL the launch needs (the first buy + the create's own costs), with
 * Kamby's fixed launch fee as a USDC transfer in the same transaction. Create: PumpPortal's
 * create-with-first-buy transaction (trade-local; the creator pays it from that SOL), checked
 * here — only known programs, nothing that moves tokens the creator already has, and a simulated
 * SOL spend within what the launch should cost — then co-signed with the new mint's key.
 */
@Injectable()
export class PumpFunAdapter implements LaunchAdapter {
  readonly id = 'pumpfun' as const;
  readonly chainIdentifier = 'solana';
  private readonly treasuryUsdcAta: string | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly relayer: GasRelayerService,
    private readonly jupiter: JupiterQuoteService,
    private readonly logger: PinoLogger,
  ) {
    this.treasuryUsdcAta = getSolanaConfig((key) => config.get(key, { infer: true }))?.treasuryUsdcAta ?? null;
    this.logger.setContext('PumpFunAdapter');
  }

  private connection(): Connection {
    const connection = this.relayer.relayerConnection;
    if (!connection || !this.relayer.feePayerPublicKey || !this.treasuryUsdcAta) {
      throw new UnprocessableEntityException('Launching on Solana is not available right now');
    }
    return connection;
  }

  /** Lamports one US dollar buys right now (Jupiter's own price for $10 of USDC → SOL). */
  private async lamportsPerUsd(): Promise<number> {
    const out = await this.jupiter.getEstimatedOutputRaw({ inputMint: SOLANA_USDC_MINT, outputMint: SOLANA_NATIVE_MINT, amountRaw: '10000000', slippageBps: 50 });
    const lamports = out ? Number(out) / 10 : NaN;
    if (!(lamports > 0)) throw new UnprocessableEntityException("Couldn't price SOL right now — try again in a moment");
    return lamports;
  }

  async buildFunding(launch: TokenLaunch, feeUsd: number): Promise<PreparedStep> {
    const connection = this.connection();
    const relayer = this.relayer.feePayerPublicKey!;
    const perUsd = await this.lamportsPerUsd();
    const devBuyLamports = Math.round(Number(launch.devBuyUsd) * perUsd);
    const balance = await connection.getBalance(new PublicKey(launch.walletAddress), 'confirmed');
    // SOL already in the wallet (say, from an earlier try) counts toward what's needed.
    const shortLamports = Math.max(0, devBuyLamports + CREATE_RESERVE_LAMPORTS - balance);
    const fundUsdcRaw = BigInt(Math.max(Number(MIN_FUNDING_USDC_RAW), Math.ceil((shortLamports / perUsd) * FUNDING_BUFFER * 1e6)));
    const feeRaw = BigInt(Math.round(feeUsd * 1e6));

    const instructions = await this.jupiter.getSwapInstructions({
      inputMint: SOLANA_USDC_MINT,
      outputMint: SOLANA_NATIVE_MINT,
      amountRaw: fundUsdcRaw.toString(),
      slippageBps: 100,
      userPublicKey: launch.walletAddress,
      platformFeeBps: 0,
      feeAccount: this.treasuryUsdcAta!,
      payer: relayer,
    });
    if (!instructions) throw new UnprocessableEntityException("Couldn't get a USDC → SOL price right now — try again in a moment");
    const transaction = await buildSponsoredSwapTransaction(connection, new PublicKey(relayer), SOLANA_NATIVE_MINT, instructions, [
      setupFeeInstruction(launch.walletAddress, this.treasuryUsdcAta!, feeRaw),
    ]);
    return {
      transactionBase64: Buffer.from(transaction.serialize()).toString('base64'),
      networkCostUsd: CREATE_RESERVE_LAMPORTS / perUsd,
      fundUsdcRaw: fundUsdcRaw.toString(),
    };
  }

  async submitFunding(launch: TokenLaunch, proof: LaunchProof): Promise<string> {
    const connection = this.connection();
    const signedTxBase64 = requireSigned(proof);
    if (!launch.fundTx) throw new UnprocessableEntityException('This launch has no funding step to sign');
    const signature = await this.relayer.submitSponsoredLaunchFunding({
      userId: launch.userId,
      walletAddress: launch.walletAddress,
      expectedUnsignedTxBase64: launch.fundTx,
      partiallySignedTxBase64: signedTxBase64,
    });
    await waitForConfirmation(connection, signature);
    return signature;
  }

  async buildCreate(launch: TokenLaunch, metadata: LaunchMetadata): Promise<PreparedStep> {
    const connection = this.connection();
    const wallet = new PublicKey(launch.walletAddress);
    const balance = await connection.getBalance(wallet, 'confirmed');
    const spendable = balance - CREATE_RESERVE_LAMPORTS;
    if (spendable < 0) throw new UnprocessableEntityException('Not enough SOL for the launch yet — the funding step may still be landing. Try again in a few seconds.');
    const target = Number(launch.devBuyUsd) > 0 ? Math.round(Number(launch.devBuyUsd) * (await this.lamportsPerUsd())) : 0;
    const devBuyLamports = Math.min(target, spendable);

    const mint = Keypair.generate();
    const response = await fetch(PUMPPORTAL_TRADE_LOCAL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicKey: launch.walletAddress,
        action: 'create',
        tokenMetadata: { name: metadata.name, symbol: metadata.symbol, uri: metadata.metadataUri },
        mint: mint.publicKey.toBase58(),
        denominatedInSol: 'true',
        amount: devBuyLamports / LAMPORTS_PER_SOL,
        slippage: 15,
        priorityFee: 0.0005,
        pool: 'pump',
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response || response.status !== 200) {
      this.logger.warn({ status: response?.status }, 'pumpportal create request failed');
      throw new UnprocessableEntityException("Pump.fun didn't answer — nothing was spent on the coin yet. Try again in a moment.");
    }
    const transaction = VersionedTransaction.deserialize(new Uint8Array(await response.arrayBuffer()));
    await this.checkCreate(connection, transaction, wallet, devBuyLamports);
    transaction.sign([mint]);
    return { transactionBase64: Buffer.from(transaction.serialize()).toString('base64'), tokenAddress: mint.publicKey.toBase58() };
  }

  /** Only the creator pays, only known programs, nothing touches tokens they already hold, and
   *  the simulated SOL spend is no more than the first buy plus the create's own costs. */
  private async checkCreate(connection: Connection, transaction: VersionedTransaction, wallet: PublicKey, devBuyLamports: number): Promise<void> {
    const keys = transaction.message.staticAccountKeys;
    if (transaction.message.addressTableLookups.length > 0) throw new ForbiddenException('Unexpected launch transaction shape — refusing to hand it out');
    if (!keys[0]?.equals(wallet)) throw new ForbiddenException("The launch transaction isn't paid by your wallet — refusing to hand it out");
    for (const ix of transaction.message.compiledInstructions) {
      const program = keys[ix.programIdIndex]?.toBase58();
      if (!program || !CREATE_PROGRAMS.has(program)) {
        this.logger.warn({ program }, 'pump.fun create uses an unexpected program');
        throw new ForbiddenException('The launch transaction uses an unexpected program — refusing to hand it out');
      }
      if ((program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) && TOKEN_MOVING_INSTRUCTIONS.has(ix.data[0] ?? -1)) {
        throw new ForbiddenException('The launch transaction moves tokens — refusing to hand it out');
      }
    }
    const before = await connection.getBalance(wallet, 'confirmed');
    const simulation = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      accounts: { encoding: 'base64', addresses: [wallet.toBase58()] },
    });
    if (simulation.value.err) {
      this.logger.warn({ err: simulation.value.err, logs: simulation.value.logs?.slice(-6) }, 'pump.fun create failed simulation');
      throw new UnprocessableEntityException('The launch would fail right now — nothing was sent. Try again in a moment.');
    }
    const after = simulation.value.accounts?.[0]?.lamports;
    const maxSpend = devBuyLamports * 1.02 + CREATE_RESERVE_LAMPORTS;
    if (after === undefined || before - after > maxSpend) {
      this.logger.warn({ spend: after === undefined ? null : before - after, maxSpend }, 'pump.fun create would spend more SOL than expected');
      throw new ForbiddenException('The launch transaction would spend more than expected — refusing to hand it out');
    }
  }

  async submitCreate(launch: TokenLaunch, proof: LaunchProof): Promise<{ signature: string; tokensRaw: string | null }> {
    const connection = this.connection();
    const signedTxBase64 = requireSigned(proof);
    if (!launch.createTx || !launch.tokenAddress) throw new UnprocessableEntityException('This launch has no create step to sign');
    let transaction: VersionedTransaction;
    try {
      transaction = VersionedTransaction.deserialize(Buffer.from(signedTxBase64, 'base64'));
    } catch {
      throw new UnprocessableEntityException('Malformed transaction bytes');
    }
    if (!solanaTransactionMatchesQuote(transaction, launch.createTx)) throw new ForbiddenException('This transaction does not match the launch you prepared');
    const raw = transaction.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
    rebroadcastUntilLanded(connection, raw, signature, this.logger);
    await waitForConfirmation(connection, signature);
    return { signature, tokensRaw: await tokensReceived(connection, signature, launch.walletAddress, launch.tokenAddress) };
  }
}

function requireSigned(proof: LaunchProof): string {
  if (!proof.signedTxBase64) throw new UnprocessableEntityException('Send the signed transaction');
  return proof.signedTxBase64;
}

/** Waits up to ~45s for a signature to confirm; throws if it failed or never landed. */
async function waitForConfirmation(connection: Connection, signature: string): Promise<void> {
  for (let i = 0; i < 45; i++) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new UnprocessableEntityException('The transaction failed on-chain — nothing more was spent.');
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new UnprocessableEntityException("The transaction hasn't confirmed yet — check again in a minute.");
}

/** How many of the new coin the first buy got (raw), from the confirmed transaction. */
async function tokensReceived(connection: Connection, signature: string, owner: string, mint: string): Promise<string | null> {
  try {
    const tx = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const balance = tx?.meta?.postTokenBalances?.find((b) => b.owner === owner && b.mint === mint);
    return balance?.uiTokenAmount.amount ?? null;
  } catch {
    return null;
  }
}

