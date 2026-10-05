import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey } from '@solana/web3.js';
import { prisma } from '@kamby/db';
import { MIN_TRADE_MESSAGE, MIN_TRADE_USD, PLATFORM_FEE_FALLBACK_BPS, resolveTierFeeBps, SOLANA_USDC_MINT, TRADING_DEFAULTS, type TradeSide } from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
import { buildSponsoredSwapTransaction } from './gas-relayer-transaction-builder';
import { resolveNewCoinSetupFee, setupFeeInstruction } from './new-coin-setup-fee';
import { GasRelayerService } from './gas-relayer.service';
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
  /** See JupiterQuoteService's own doc comment — the user's own wallet pays this, passed
   *  straight through to Jupiter's native jitoTipLamports support. 0/undefined omits it. */
  jitoTipLamports?: number;
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
  /** See new-coin-setup-fee.ts — only on a gasless first buy of a coin. */
  setupFeeAmountRaw?: string | null;
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
 * resolved per-trade via `resolvePlatformFeeBps` below. As of the fee-tier reconciliation,
 * that resolves through `resolveTierFeeBps`/`PLATFORM_FEE_TIERS` (`@kamby/domain`) — the
 * same $1-99/2%, $100-499/1%, $500+/0.75% schedule EVM already used, not a Solana-only
 * schedule (the old two-tier `resolveJupiterPlatformFeeBps` is gone). The env var is left
 * defined (harmless if set) but has no effect on this service any more.
 */
/** The highest platform fee Jupiter's swap endpoints accept (a u8 on their side): 2.55%. */
export const JUPITER_MAX_PLATFORM_FEE_BPS = 255;

@Injectable()
export class SolanaQuoteService {
  private readonly treasuryUsdcAta: string | null;
  private readonly gasRelayerTestWalletAddresses: ReadonlySet<string> | null;

  constructor(
    private readonly jupiter: JupiterQuoteService,
    private readonly gasRelayer: GasRelayerService,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
    this.treasuryUsdcAta = solanaConfig?.treasuryUsdcAta ?? null;
    this.gasRelayerTestWalletAddresses = solanaConfig?.gasRelayerTestWalletAddresses ?? null;
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
      jitoTipLamports: params.jitoTipLamports,
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
   * The sponsored-quote path — see docs/GAS_RELAYER_PLAN.md and `GasRelayerService`'s own
   * doc comment. A dedicated method (and, at the controller
   * layer, a dedicated route) rather than a flag on `createQuote` above: whether a
   * deployment sponsors gas at all is an explicit, auditable code path, never an implicit
   * branch inside the main quote flow every self-paid trade also goes through.
   *
   * The returned `unsignedTxBase64` names the relayer, not the caller's own wallet, as fee
   * payer — the caller must sign only their own required-signer slot (never attempt to pay
   * the fee themselves) and submit the result to `GasRelayerService#submitSponsoredTransaction`
   * (via `POST /solana/transactions/sponsored`), never the ordinary submit endpoint.
   */
  async createSponsoredQuote(params: CreateSolanaQuoteParams): Promise<SolanaQuoteResult> {
    if (this.treasuryUsdcAta === null) {
      throw new UnprocessableEntityException('Solana trading is not enabled on this deployment');
    }
    const relayerPublicKey = this.gasRelayer.feePayerPublicKey;
    const relayerConnection = this.gasRelayer.relayerConnection;
    if (relayerPublicKey === null || relayerConnection === null) {
      throw new UnprocessableEntityException('Gas sponsorship is not enabled on this deployment');
    }
    // A rollout gate, not a security boundary — see SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES's
    // own doc comment (config/env.ts). Deliberately the exact same rejection message as "not
    // enabled at all" above, so a caller can never distinguish "this deployment doesn't
    // sponsor gas" from "you're just not on the allowlist yet."
    if (this.gasRelayerTestWalletAddresses !== null && !this.gasRelayerTestWalletAddresses.has(params.walletAddress)) {
      throw new UnprocessableEntityException('Gas sponsorship is not enabled on this deployment');
    }
    await this.assertWalletOwnership(params.userId, params.walletAddress);

    const { inputMint, outputMint } = params.side === 'BUY'
      ? { inputMint: SOLANA_USDC_MINT, outputMint: params.tokenMint }
      : { inputMint: params.tokenMint, outputMint: SOLANA_USDC_MINT };

    const platformFeeBps = await this.resolvePlatformFeeBps(params.side, inputMint, outputMint, params.amount, params.slippageBps);

    // New-coin setup charge: on a buy of a coin this wallet has never held, the relayer pays
    // ~0.002 SOL of rent for its token account — charged back in USDC from the amount entered
    // (see new-coin-setup-fee.ts). The swap uses the rest, so the user pays exactly what they typed.
    // A failed check never blocks the trade — Kamby absorbs that one setup instead.
    const setupFeeRaw =
      params.side === 'BUY'
        ? await resolveNewCoinSetupFee(relayerConnection, params.walletAddress, outputMint).catch((error: unknown) => {
            this.logger.warn({ err: error }, 'new-coin setup check failed — no setup charge on this quote');
            return 0n;
          })
        : 0n;
    // On a buy Kamby takes its fee itself, as a USDC transfer in the same transaction (like the
    // setup charge), never through Jupiter's platform fee: that fails with Jupiter error 6014
    // on Token-2022 coins with a transfer tax (found 2026-10-04 on a stonk.fun coin — the
    // same swap without Jupiter's fee simulates fine). Off the USDC entered, like EVM buys.
    const buyFeeRaw = params.side === 'BUY' ? (BigInt(params.amount) * BigInt(platformFeeBps)) / 10_000n : 0n;
    const swapAmountRaw = BigInt(params.amount) - setupFeeRaw - buyFeeRaw;
    if (swapAmountRaw <= 0n) {
      throw new UnprocessableEntityException(`First buy of this coin needs more than $${(Number(setupFeeRaw) / 1e6).toFixed(2)} (new coin setup)`);
    }

    const instructions = await this.jupiter.getSwapInstructions({
      inputMint,
      outputMint,
      amountRaw: swapAmountRaw.toString(),
      slippageBps: params.slippageBps,
      userPublicKey: params.walletAddress,
      platformFeeBps: params.side === 'BUY' ? 0 : platformFeeBps,
      feeAccount: this.treasuryUsdcAta,
      payer: relayerPublicKey,
    });
    if (!instructions) {
      throw new UnprocessableEntityException('No live quote is available for this trade right now — try again shortly');
    }

    const transaction = await buildSponsoredSwapTransaction(
      relayerConnection,
      new PublicKey(relayerPublicKey),
      outputMint,
      instructions,
      setupFeeRaw + buyFeeRaw > 0n ? [setupFeeInstruction(params.walletAddress, this.treasuryUsdcAta, setupFeeRaw + buyFeeRaw)] : [],
    );
    const unsignedTxBase64 = Buffer.from(transaction.serialize()).toString('base64');

    const expiresAt = new Date(Date.now() + TRADING_DEFAULTS.quoteTtlSeconds * 1000);
    const row = await prisma.solanaTradeQuote.create({
      data: {
        userId: params.userId,
        walletAddress: params.walletAddress,
        side: params.side,
        inputMint,
        outputMint,
        inputAmount: instructions.inputAmountRaw,
        expectedOutputAmount: instructions.outputAmountRaw,
        minOutputAmount: instructions.minOutputAmountRaw,
        priceImpactBps: instructions.priceImpactBps,
        slippageBps: params.slippageBps,
        platformFeeBps,
        platformFeeAmount: params.side === 'BUY' ? buyFeeRaw.toString() : (instructions.platformFeeAmountRaw ?? '0'),
        // A buy's full USDC cost (swap + Kamby fee + new-coin setup) — what the PnL ledger counts as
        // its cost basis; inputAmount is only the swapped part (2026-10-05: PnL overstated profit).
        unsignedTx: params.side === 'BUY' ? { base64: unsignedTxBase64, totalPaidRaw: params.amount } : { base64: unsignedTxBase64 },
        expiresAt,
      },
    });
    this.logger.info({ quoteId: row.id, side: params.side }, 'sponsored solana quote created');

    return {
      id: row.id,
      side: params.side,
      inputMint,
      outputMint,
      inputAmountRaw: instructions.inputAmountRaw,
      outputAmountRaw: instructions.outputAmountRaw,
      minOutputAmountRaw: instructions.minOutputAmountRaw,
      priceImpactBps: instructions.priceImpactBps,
      platformFeeBps,
      // USDC raw on both sides here: a buy's fee is Kamby's own transfer, a sell's is Jupiter's (USDC output).
      platformFeeAmountRaw: params.side === 'BUY' ? buyFeeRaw.toString() : instructions.platformFeeAmountRaw,
      setupFeeAmountRaw: setupFeeRaw > 0n ? setupFeeRaw.toString() : null,
      unsignedTxBase64,
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
   * JupiterQuoteService's own doc comment). Falls back to `PLATFORM_FEE_FALLBACK_BPS` (the
   * most expensive tier) on any failure to discover the real size — this must never
   * silently apply a cheaper, unconfirmed tier to a trade whose real size was never
   * actually confirmed. Resolves through the same `resolveTierFeeBps`/`PLATFORM_FEE_TIERS`
   * EVM uses — see this class's own doc comment for why Solana no longer has its own
   * separate schedule.
   */
  private async resolvePlatformFeeBps(side: TradeSide, inputMint: string, outputMint: string, amount: string, slippageBps: number): Promise<number> {
    // Jupiter's /swap and /swap-instructions take platformFeeBps as a u8: anything above 255
    // fails with a 500 ("out of range integral type conversion") even though /quote accepts it
    // — found 2026-10-04 when the 4% micro tier broke every Solana trade under $10.
    return Math.min(JUPITER_MAX_PLATFORM_FEE_BPS, await this.resolveTierBps(side, inputMint, outputMint, amount, slippageBps));
  }

  private async resolveTierBps(side: TradeSide, inputMint: string, outputMint: string, amount: string, slippageBps: number): Promise<number> {
    // The $2 minimum rides on the same trade-size lookup (USDC in for a buy, USDC out for a sell).
    if (side === 'BUY') {
      const tradeSizeUsd = Number(amount) / 10 ** 6;
      if (tradeSizeUsd < MIN_TRADE_USD) throw new UnprocessableEntityException(MIN_TRADE_MESSAGE);
      return resolveTierFeeBps(tradeSizeUsd);
    }
    const estimatedOutputRaw = await this.jupiter.getEstimatedOutputRaw({ inputMint, outputMint, amountRaw: amount, slippageBps });
    if (estimatedOutputRaw === null) return PLATFORM_FEE_FALLBACK_BPS;
    const tradeSizeUsd = Number(estimatedOutputRaw) / 10 ** 6;
    if (tradeSizeUsd < MIN_TRADE_USD) throw new UnprocessableEntityException(MIN_TRADE_MESSAGE);
    return resolveTierFeeBps(tradeSizeUsd);
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
