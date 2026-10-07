import { ForbiddenException, Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { SOLANA_USDC_MINT } from '@kamby/domain';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ConfigService } from '@nestjs/config';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { PinoLogger } from 'nestjs-pino';
import { SOLANA_CONNECTION_POOL, type SolanaConnectionPool } from '../chain/solana-connection-pool';
import { getSolanaConfig, type Env } from '../config/env';

/** A wallet must hold this much USDC (raw, 6 decimals) to get withdrawal gas: $5. */
const WITHDRAW_GAS_MIN_USDC_RAW = 5_000_000n;
/** A SOL-holding wallet can't sit below the rent-exempt minimum (0-data account). */
const WALLET_RENT_MIN_LAMPORTS = 890_880;
/** The transfer's network fee, with headroom for a priority fee. */
const WITHDRAW_FEE_LAMPORTS = 20_000;
/** Rent for the recipient's token account when it doesn't exist yet (Token-2022 headroom). */
const RECIPIENT_ACCOUNT_RENT_LAMPORTS = 2_100_000;
/** Withdrawal gas sends per wallet per 30 days: enough for real use, useless to farm. */
const WITHDRAW_GAS_MAX_PER_WALLET = 3;

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
  private readonly fundingKeypair: Keypair | null;
  private readonly topupLamports: number;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
    @Inject(SOLANA_CONNECTION_POOL) private readonly solanaPool: SolanaConnectionPool | null,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    // Never logged — see the `redact` config in app.module.ts. Only the derived public key
    // (via `Keypair.publicKey`, when actually needed) is ever safe to log.
    this.fundingKeypair = solanaConfig ? Keypair.fromSecretKey(bs58.decode(solanaConfig.topupFundingSecretKey)) : null;
    this.topupLamports = solanaConfig ? Math.round(solanaConfig.newWalletTopupSol * LAMPORTS_PER_SOL) : 0;
    this.logger.setContext('SolanaTopupService');
  }

  /**
   * Withdrawal gas (2026-10-07, replaces the signup gift): sent only when the user is about to
   * withdraw, only to their own verified wallet holding at least $5 USDC, and only the exact
   * lamports this one transfer needs (fee + the wallet's rent minimum, plus the recipient's
   * token-account rent when that account doesn't exist yet). At most 3 per wallet per 30 days.
   */
  async fundWithdrawal(params: { userId: string; address: string; destination?: string; mint?: string }): Promise<TopupResult> {
    if (!this.solanaPool || !this.fundingKeypair) {
      throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    }
    const pool = this.solanaPool;
    const wallet = await prisma.wallet.findUnique({ where: { address: params.address } });
    if (!wallet || wallet.userId !== params.userId || wallet.verifiedAt === null || wallet.chain !== 'SOLANA') {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
    const owner = new PublicKey(params.address);
    const usdcRaw = await pool
      .withPublicFirst((c) => c.getTokenAccountBalance(getAssociatedTokenAddressSync(new PublicKey(SOLANA_USDC_MINT), owner)))
      .then((r) => BigInt(r.value.amount))
      .catch(() => 0n);
    if (usdcRaw < WITHDRAW_GAS_MIN_USDC_RAW) return { toppedUp: false, signature: null };

    let needsRecipientAccount = false;
    if (params.mint && params.destination) {
      const mintKey = new PublicKey(params.mint);
      const mintInfo = await pool.withPublicFirst((c) => c.getAccountInfo(mintKey)).catch(() => null);
      const recipientAta = getAssociatedTokenAddressSync(mintKey, new PublicKey(params.destination), true, mintInfo?.owner);
      needsRecipientAccount = !(await pool.withPublicFirst((c) => c.getAccountInfo(recipientAta)).catch(() => null));
    }
    const needed = WALLET_RENT_MIN_LAMPORTS + WITHDRAW_FEE_LAMPORTS + (needsRecipientAccount ? RECIPIENT_ACCOUNT_RENT_LAMPORTS : 0);
    const balance = await pool.withFailover((c) => c.getBalance(owner, 'confirmed')).catch(() => null);
    if (balance === null || balance >= needed) return { toppedUp: false, signature: null };

    if (this.redis) {
      const key = `sol-withdraw-gas:${params.address}`;
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, 30 * 24 * 3600);
      if (count > WITHDRAW_GAS_MAX_PER_WALLET) {
        throw new UnprocessableEntityException('Withdrawal gas limit reached for this wallet. Add a little SOL to withdraw');
      }
    }
    return this.sendLamports(params.address, needed - balance);
  }

  private async sendLamports(address: string, lamports: number): Promise<TopupResult> {
    const fundingKeypair = this.fundingKeypair!;
    const transaction = new Transaction().add(SystemProgram.transfer({ fromPubkey: fundingKeypair.publicKey, toPubkey: new PublicKey(address), lamports }));
    try {
      const signature = await this.solanaPool!.withFailover((connection) => sendAndConfirmTransaction(connection, transaction, [fundingKeypair]));
      this.logger.info({ address, lamports }, 'sent Solana withdrawal gas');
      return { toppedUp: true, signature };
    } catch (error) {
      this.logger.warn({ err: error, address }, 'Solana withdrawal gas send failed');
      return { toppedUp: false, signature: null };
    }
  }

  /** The old signup gift. No longer called by the app (see fundWithdrawal); kept for its tests. */
  async ensureFunded(address: string): Promise<TopupResult> {
    if (!this.solanaPool || !this.fundingKeypair) {
      throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    }
    const pool = this.solanaPool;
    const fundingKeypair = this.fundingKeypair;

    const recipient = new PublicKey(address);
    const balanceLamports = await pool.withFailover((connection) => connection.getBalance(recipient, 'confirmed')).catch(() => null);
    if (balanceLamports !== null && balanceLamports >= this.topupLamports) {
      return { toppedUp: false, signature: null };
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fundingKeypair.publicKey,
        toPubkey: recipient,
        lamports: this.topupLamports,
      }),
    );

    try {
      // Safe to retry the identical signed transaction against the fallback connection if
      // the primary's confirmation polling (not necessarily the broadcast itself) fails:
      // a transaction's signature is derived from its own signed bytes, so resending the
      // exact same transaction is a no-op on Solana's side if it already landed, not a
      // double-send.
      const signature = await pool.withFailover((connection) => sendAndConfirmTransaction(connection, transaction, [fundingKeypair]));
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
