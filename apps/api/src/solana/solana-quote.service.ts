import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { SOLANA_USDC_MINT, TRADING_DEFAULTS, type TradeSide } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
import { resolveJupiterPlatformFeeBps } from './jupiter-fee-schedule';
import { JupiterQuoteService } from './jupiter-quote.service';

export interface CreateSolanaQuoteParams {
  userId: string;
  walletAddress: string;
  side: TradeSide;
  tokenMint: string;
  /** Raw integer units (pre-decimals), as a string, denominated in the *input* token for
   *  this side — USDC (6 decimals) for BUY, tokenMint for SELL. Never a JS number. */
  amount: string;
  slippageBps: number;
}

export interface SolanaQuoteResult {
  id: string;
  side: TradeSide;
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputAmountRaw: string;
  minOutputAmountRaw: string;
  priceImpactBps: number | null;
  platformFeeBps: number;
  platformFeeAmountRaw: string | null;
  unsignedTxBase64: string;
  expiresAt: string;
  createdAt: string;
}

/**
 * Solana's counterpart to QuoteService — orchestrates one quote: confirms the caller
 * actually owns the wallet it's for, asks Jupiter for a real price + built transaction,
 * and persists the result so it can be checked again at submission time. Deliberately
 * much simpler than QuoteService: Jupiter's `platformFeeBps`/`feeAccount` deduct the
 * platform fee atomically inside the swap itself, so there's no manual fee-splitting math
 * or separate guaranteed-USDC-fee-transfer concept here (see JupiterQuoteService's own
 * doc comment on why quote + transaction-building are one call for Jupiter, unlike the
 * EVM SwapRouter interface).
 *
 * `SOLANA_JUPITER_PLATFORM_FEE_BPS` is no longer read here as of 2026-09-13 — the fee is
 * now resolved per-trade from `resolveJupiterPlatformFeeBps` (see
 * `resolvePlatformFeeBps` below), not a single static configured value. The env var is
 * left defined (harmless if set) but has no effect on this service any more.
 */
@Injectable()
export class SolanaQuoteService {
  private readonly treasuryUsdcAta: string | null;

  constructor(
    private readonly jupiter: JupiterQuoteService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.treasuryUsdcAta = solanaConfig?.treasuryUsdcAta ?? null;
    this.logger.setContext('SolanaQuoteService');
  }

  async createQuote(params: CreateSolanaQuoteParams): Promise<SolanaQuoteResult> {
    if (this.treasuryUsdcAta === null) {
      // SOLANA_ENABLED is false on this deployment — never silently quote against an
      // unconfigured fee destination.
      throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    }
    await this.assertWalletOwnership(params.userId, params.walletAddress);

    const { inputMint, outputMint } = params.side === 'BUY'
      ? { inputMint: SOLANA_USDC_MINT, outputMint: params.tokenMint }
      : { inputMint: params.tokenMint, outputMint: SOLANA_USDC_MINT };

    const platformFeeBps = await this.resolvePlatformFeeBps(params.side, inputMint, outputMint, params.amount, params.slippageBps);

    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amountRaw: params.amount,
      slippageBps: params.slippageBps,
      userPublicKey: params.walletAddress,
      platformFeeBps,
      feeAccount: this.treasuryUsdcAta,
    });
    if (!quote) {
      throw new UnprocessableEntityException('No live quote is available for this trade right now — try again shortly');
    }

    const expiresAt = new Date(Date.now() + TRADING_DEFAULTS.quoteTtlSeconds * 1000);
    const row = await prisma.solanaTradeQuote.create({
      data: {
        userId: params.userId,
        walletAddress: params.walletAddress,
        side: params.side,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inputAmount: quote.inputAmountRaw,
        expectedOutputAmount: quote.outputAmountRaw,
        minOutputAmount: quote.minOutputAmountRaw,
        priceImpactBps: quote.priceImpactBps,
        slippageBps: params.slippageBps,
        platformFeeBps: quote.platformFeeBps,
        platformFeeAmount: quote.platformFeeAmountRaw ?? '0',
        unsignedTx: { base64: quote.unsignedTxBase64 },
        expiresAt,
      },
    });
    this.logger.info({ quoteId: row.id, side: params.side }, 'solana quote created');

    return {
      id: row.id,
      side: params.side,
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inputAmountRaw: quote.inputAmountRaw,
      outputAmountRaw: quote.outputAmountRaw,
      minOutputAmountRaw: quote.minOutputAmountRaw,
      priceImpactBps: quote.priceImpactBps,
      platformFeeBps: quote.platformFeeBps,
      platformFeeAmountRaw: quote.platformFeeAmountRaw,
      unsignedTxBase64: quote.unsignedTxBase64,
      expiresAt: expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * BUY: the trade's USD size is exactly the input amount (always USDC) — known upfront,
   * no extra call needed. SELL: the USD size is the *output* (also always USDC), which
   * Jupiter only reveals once it actually prices the trade — a lightweight quote-only call
   * (no fee requested, no swap transaction built) discovers it first, at the cost of one
   * extra round trip Jupiter's rate limit already accounts for (see
   * JupiterQuoteService's own doc comment). Falls back to the higher, under-$50 tier on
   * any failure to discover the real size — this must never silently apply the *lower*
   * institutional rate to a trade whose real size was never actually confirmed.
   */
  private async resolvePlatformFeeBps(side: TradeSide, inputMint: string, outputMint: string, amount: string, slippageBps: number): Promise<number> {
    if (side === 'BUY') {
      const tradeSizeUsd = Number(amount) / 10 ** 6;
      return resolveJupiterPlatformFeeBps(tradeSizeUsd);
    }
    const estimatedOutputRaw = await this.jupiter.getEstimatedOutputRaw({ inputMint, outputMint, amountRaw: amount, slippageBps });
    if (estimatedOutputRaw === null) return resolveJupiterPlatformFeeBps(0);
    const tradeSizeUsd = Number(estimatedOutputRaw) / 10 ** 6;
    return resolveJupiterPlatformFeeBps(tradeSizeUsd);
  }

  /** Same ownership contract as QuoteService#assertWalletOwnership — a client-supplied
   *  wallet address is never trusted without a verified link to the calling session. */
  private async assertWalletOwnership(userId: string, walletAddress: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== userId || wallet.verifiedAt === null || wallet.chain !== 'SOLANA') {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
  }
}
