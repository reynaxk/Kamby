import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { SOLANA_USDC_MINT, TRADING_DEFAULTS, type TradeSide } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
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
 */
@Injectable()
export class SolanaQuoteService {
  private readonly platformFeeBps: number;
  private readonly treasuryUsdcAta: string | null;

  constructor(
    private readonly jupiter: JupiterQuoteService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.platformFeeBps = solanaConfig?.jupiterPlatformFeeBps ?? 0;
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

    const quote = await this.jupiter.getQuote({
      inputMint,
      outputMint,
      amountRaw: params.amount,
      slippageBps: params.slippageBps,
      userPublicKey: params.walletAddress,
      platformFeeBps: this.platformFeeBps,
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

  /** Same ownership contract as QuoteService#assertWalletOwnership — a client-supplied
   *  wallet address is never trusted without a verified link to the calling session. */
  private async assertWalletOwnership(userId: string, walletAddress: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== userId || wallet.verifiedAt === null || wallet.chain !== 'SOLANA') {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
  }
}
