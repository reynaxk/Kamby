import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';

export interface TopupResult {
  toppedUp: boolean;
  signature: string | null;
}

/**
 * Sends a brand-new embedded wallet a small, one-time SOL top-up so trading doesn't feel
 * broken even though launch ships non-custodial (the wallet pays its own gas after this —
 * see docs/WALLET_SECURITY.md's Solana section). Deliberately a much smaller, much safer
 * problem than the deferred gasless relayer: this key only ever sends exactly one
 * instruction type (a fixed System Program transfer) to exactly one recipient category (a
 * wallet this backend just verified), so there is no arbitrary-instruction surface to
 * validate the way GasRelayerService will need.
 *
 * Idempotency is a *live balance check*, not a persisted "already topped up" flag: if the
 * wallet's current balance is already at or above the configured top-up amount, this is a
 * no-op. This trades perfect precision (a wallet that spent back down to near-zero
 * legitimately won't get topped up again) for not needing another schema/migration for a
 * tiny, bounded, non-security-critical amount — a deliberate, documented choice, not an
 * oversight. Revisit if top-up abuse ever turns out to be a real problem in practice.
 */
@Injectable()
export class SolanaTopupService {
  private readonly connection: Connection | null;
  private readonly fundingKeypair: Keypair | null;
  private readonly topupLamports: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.connection = solanaConfig ? new Connection(solanaConfig.rpcUrl, 'confirmed') : null;
    // Never logged — see the `redact` config in app.module.ts. Only the derived public key
    // (via `Keypair.publicKey`, when actually needed) is ever safe to log.
    this.fundingKeypair = solanaConfig ? Keypair.fromSecretKey(bs58.decode(solanaConfig.topupFundingSecretKey)) : null;
    this.topupLamports = solanaConfig ? Math.round(solanaConfig.newWalletTopupSol * LAMPORTS_PER_SOL) : 0;
    this.logger.setContext('SolanaTopupService');
  }

  async ensureFunded(address: string): Promise<TopupResult> {
    if (!this.connection || !this.fundingKeypair) {
      throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    }

    const recipient = new PublicKey(address);
    const balanceLamports = await this.connection.getBalance(recipient, 'confirmed').catch(() => null);
    if (balanceLamports !== null && balanceLamports >= this.topupLamports) {
      return { toppedUp: false, signature: null };
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.fundingKeypair.publicKey,
        toPubkey: recipient,
        lamports: this.topupLamports,
      }),
    );

    try {
      const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.fundingKeypair]);
      this.logger.info({ address, lamports: this.topupLamports }, 'sent new-wallet SOL top-up');
      return { toppedUp: true, signature };
    } catch (error) {
      // A failed top-up is never fatal to wallet linking itself — the caller (identity
      // flow) has already succeeded by the time this runs; log and let the user proceed
      // with a wallet that just doesn't have gas yet, same as any other funding shortfall.
      this.logger.warn({ err: error, address }, 'new-wallet SOL top-up failed');
      return { toppedUp: false, signature: null };
    }
  }
}
