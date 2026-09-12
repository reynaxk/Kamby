import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import {
  calculateFeeAmount,
  calculateMinOutputAmount,
  classifyPriceImpactBps,
  normalizeEvmAddress,
  SAFETY_DISCLAIMER,
  TRADING_DEFAULTS,
  type TradeQuoteDto,
  type TradeSide,
} from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { formatUnits, parseUnits } from 'viem';
import { getConfiguredChains, type ConfiguredChain, type Env } from '../config/env';
import { buildErc20TransferTx } from './erc20-transfer';
import { SWAP_ROUTER } from './router/swap-router.token';
import type { SwapRouter } from './router/swap-router.interface';
import { SafetyService, type TradableMarket } from './safety.service';

export interface CreateQuoteParams {
  userId: string;
  walletAddress: string;
  tokenAddress: string;
  chainId: number;
  side: TradeSide;
  /** A decimal string denominated in the *input* token for this side — the quote token for
   *  BUY, the base token for SELL. Never a JS number, see docs/TRADING.md#financial-precision. */
  amount: string;
  slippageBps: number;
}

/**
 * Orchestrates one quote: validates the request, confirms the caller actually owns the
 * wallet it's for, asks the router for a real price, applies the platform fee, and
 * persists the result so it can be checked again (never trusted blindly) at submission
 * time. See docs/TRADING.md#quote-system.
 */
@Injectable()
export class QuoteService {
  private readonly feeBps: number;
  private readonly feeRecipient: string;
  private readonly chains: Map<number, ConfiguredChain>;

  constructor(
    private readonly safety: SafetyService,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.feeBps = config.get('PLATFORM_FEE_BPS', { infer: true });
    this.feeRecipient = config.get('PLATFORM_FEE_RECIPIENT_ADDRESS', { infer: true });
    this.chains = new Map(
      getConfiguredChains((key) => config.get(key, { infer: true })).map((c) => [c.chainId, c]),
    );
    this.logger.setContext('QuoteService');
  }

  /** Never a silent fallback to another chain's config — a chainId that reached here but
   *  isn't one of this deployment's configured chains is a real misconfiguration (the DTO
   *  boundary already rejects a chainId nothing in this codebase knows about at all; this
   *  catches "known chain, not enabled on this deployment"). */
  private resolveChain(chainId: number): ConfiguredChain {
    const chain = this.chains.get(chainId);
    if (!chain) throw new UnprocessableEntityException(`Chain ${chainId} is not configured on this deployment`);
    return chain;
  }

  async createQuote(params: CreateQuoteParams): Promise<TradeQuoteDto> {
    const walletAddress = normalizeEvmAddress(params.walletAddress);
    await this.assertWalletOwnership(params.userId, walletAddress);

    const chain = this.resolveChain(params.chainId);
    const market = await this.safety.assertTradable(params.tokenAddress, params.chainId);
    const { inputToken, outputToken } = resolveTokens(market, params.side);

    const inputAmountRaw = parseInputAmount(params.amount, inputToken.decimals!);

    // Guaranteed-USDC-fees — see docs/TRADING.md#guaranteed-usdc-fees. Eligible only when
    // this market's quote token is actually *this chain's* USDC (true for every side, since
    // quoteToken is always the input for BUY and the output for SELL) — a non-USDC-quoted
    // market (e.g. a WETH-quoted one) keeps the older, aggregator-embedded fee below,
    // unchanged. Compared against `chain.usdcAddress` (this request's own chain), never a
    // single global address — Arbitrum's USDC contract is a different address than Base's.
    const usesGuaranteedUsdcFee = normalizeEvmAddress(market.quoteToken.contractAddress) === normalizeEvmAddress(chain.usdcAddress);

    // For a BUY, the fee comes off the USDC input *before* the swap is even quoted — the
    // router is only ever asked to price the remaining 99.25%, so its own quote already
    // reflects exactly what the swap will produce.
    const preSwapFeeAmountRaw =
      usesGuaranteedUsdcFee && params.side === 'BUY' ? calculateFeeAmount(inputAmountRaw, this.feeBps) : 0n;
    const routerSellAmountRaw = inputAmountRaw - preSwapFeeAmountRaw;

    const routerQuote = await this.router.getQuote({
      chainId: params.chainId,
      sellToken: inputToken.contractAddress,
      buyToken: outputToken.contractAddress,
      sellAmountRaw: routerSellAmountRaw.toString(),
      taker: walletAddress,
      slippageBps: params.slippageBps,
      // The aggregator's own fee mechanism is only used when Kamby isn't already handling
      // the fee itself as a separate, guaranteed-USDC transfer — asking for both would
      // double-charge the user.
      feeRecipient: usesGuaranteedUsdcFee ? null : this.feeRecipient,
      feeBps: usesGuaranteedUsdcFee ? 0 : this.feeBps,
    });
    if (!routerQuote) {
      throw new UnprocessableEntityException('No live quote is available for this trade right now — try again shortly');
    }

    const grossBuyAmountRaw = BigInt(routerQuote.buyAmountRaw);
    const providerMinBuyAmountRaw = BigInt(routerQuote.minBuyAmountRaw);
    // Sanity-check the provider's own floor against ours — never trust it blindly. If it's
    // looser than what the requested slippage demands, something is wrong upstream.
    const ourMinOutputRaw = calculateMinOutputAmount(grossBuyAmountRaw, params.slippageBps);
    if (providerMinBuyAmountRaw < ourMinOutputRaw) {
      this.logger.warn(
        { providerMinBuyAmountRaw: providerMinBuyAmountRaw.toString(), ourMinOutputRaw: ourMinOutputRaw.toString() },
        'quote rejected: provider minBuyAmount looser than the requested slippage tolerance',
      );
      throw new UnprocessableEntityException('The quote returned did not honor the requested slippage tolerance');
    }

    // For a SELL, the fee is a % of the (gross) USDC the swap is expected to produce —
    // taken via a *separate* transfer after the swap, never reducing the swap's own
    // on-chain output. Computed from the quoted amount, not a post-swap actual: the
    // resulting few-atoms-of-precision gap against real slippage is economically
    // meaningless and avoids a second backend round-trip to read the real receipt.
    const postSwapFeeAmountRaw =
      usesGuaranteedUsdcFee && params.side === 'SELL' ? calculateFeeAmount(grossBuyAmountRaw, this.feeBps) : 0n;

    const platformFeeAmountRaw = usesGuaranteedUsdcFee
      ? preSwapFeeAmountRaw + postSwapFeeAmountRaw // exactly one of these is nonzero, by side
      : routerQuote.feeAmountRaw
        ? BigInt(routerQuote.feeAmountRaw)
        : calculateFeeAmount(grossBuyAmountRaw, this.feeBps);

    // What the user actually ends up with net of Kamby's fee. For a BUY this is just the
    // router's own output (the fee already came off the input side before the swap was
    // quoted); for a guaranteed-USDC SELL it's the swap's gross output minus the separate
    // fee transfer that follows it.
    const isGuaranteedUsdcSell = usesGuaranteedUsdcFee && params.side === 'SELL';
    const netBuyAmountRaw = isGuaranteedUsdcSell ? grossBuyAmountRaw - postSwapFeeAmountRaw : grossBuyAmountRaw;
    const netMinOutputRaw = isGuaranteedUsdcSell
      ? providerMinBuyAmountRaw - postSwapFeeAmountRaw
      : providerMinBuyAmountRaw;

    const feeUnsignedTx = usesGuaranteedUsdcFee
      ? buildErc20TransferTx(market.quoteToken.contractAddress, this.feeRecipient, platformFeeAmountRaw)
      : null;
    // The fee always denominates in USDC (market.quoteToken) under the guaranteed flow —
    // for a BUY that's the input token, not the output being purchased, so it must be
    // formatted with the quote token's decimals, not the output token's.
    const feeDecimals = usesGuaranteedUsdcFee ? market.quoteToken.decimals! : outputToken.decimals!;

    const priceImpactLevel = classifyPriceImpactBps(routerQuote.priceImpactBps);
    const expiresAt = new Date(Date.now() + TRADING_DEFAULTS.quoteTtlSeconds * 1000);

    const quote = await prisma.tradeQuote.create({
      data: {
        userId: params.userId,
        walletAddress,
        chainId: params.chainId,
        side: params.side,
        tokenMarketId: market.id,
        inputToken: inputToken.contractAddress,
        outputToken: outputToken.contractAddress,
        inputAmount: inputAmountRaw.toString(),
        expectedOutputAmount: netBuyAmountRaw.toString(),
        minOutputAmount: netMinOutputRaw.toString(),
        priceUsd: market.priceUsd,
        priceImpactBps: routerQuote.priceImpactBps,
        slippageBps: params.slippageBps,
        platformFeeBps: this.feeBps,
        platformFeeAmount: platformFeeAmountRaw.toString(),
        provider: routerQuote.provider,
        providerQuoteId: routerQuote.providerQuoteId,
        unsignedTx: routerQuote.unsignedTx,
        feeUnsignedTx: feeUnsignedTx ?? undefined,
        expiresAt,
      },
    });

    this.logger.info({ quoteId: quote.id, side: params.side, tokenMarketId: market.id }, 'quote created');

    return {
      id: quote.id,
      chainId: params.chainId,
      side: params.side,
      token: toTokenDto(market.token),
      quoteToken: toTokenDto(market.quoteToken),
      inputAmount: inputAmountRaw.toString(),
      expectedOutputAmount: netBuyAmountRaw.toString(),
      minOutputAmount: netMinOutputRaw.toString(),
      inputAmountFormatted: formatUnits(inputAmountRaw, inputToken.decimals!),
      expectedOutputAmountFormatted: formatUnits(netBuyAmountRaw, outputToken.decimals!),
      minOutputAmountFormatted: formatUnits(netMinOutputRaw, outputToken.decimals!),
      priceUsd: market.priceUsd === null ? null : Number(market.priceUsd),
      priceImpactBps: routerQuote.priceImpactBps,
      priceImpactLevel,
      slippageBps: params.slippageBps,
      platformFeeBps: this.feeBps,
      platformFeeAmount: platformFeeAmountRaw.toString(),
      platformFeeAmountFormatted: formatUnits(platformFeeAmountRaw, feeDecimals),
      provider: routerQuote.provider,
      expiresAt: expiresAt.toISOString(),
      createdAt: quote.createdAt.toISOString(),
      unsignedTx: routerQuote.unsignedTx,
      feeUnsignedTx,
      safetyNote: SAFETY_DISCLAIMER,
      requiresApproval: routerQuote.requiresApproval,
      approvalSpender: routerQuote.approvalSpender,
    };
  }

  /** Never trust a client-supplied wallet address as proof it belongs to the caller — see
   *  docs/TRADING.md#authorization. */
  private async assertWalletOwnership(userId: string, walletAddress: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress } });
    if (!wallet || wallet.userId !== userId || wallet.verifiedAt === null) {
      throw new ForbiddenException('This wallet is not verified as belonging to your account');
    }
  }
}

function resolveTokens(
  market: TradableMarket,
  side: TradeSide,
): { inputToken: TradableMarket['token']; outputToken: TradableMarket['quoteToken'] } {
  return side === 'BUY'
    ? { inputToken: market.quoteToken, outputToken: market.token }
    : { inputToken: market.token, outputToken: market.quoteToken };
}

function toTokenDto(token: { contractAddress: string; symbol: string | null; decimals: number | null }) {
  return { address: token.contractAddress, symbol: token.symbol, decimals: token.decimals! };
}

/** Parses a human decimal string (never a JS number) into exact raw integer units via
 *  viem's `parseUnits` — see docs/TRADING.md#financial-precision. Rejects non-positive or
 *  malformed input rather than silently coercing it. */
function parseInputAmount(amount: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new UnprocessableEntityException('amount must be a positive decimal number');
  }
  let raw: bigint;
  try {
    raw = parseUnits(amount, decimals);
  } catch {
    throw new UnprocessableEntityException('amount could not be parsed for this token\'s decimals');
  }
  if (raw <= 0n) throw new UnprocessableEntityException('amount must be greater than zero');
  return raw;
}
