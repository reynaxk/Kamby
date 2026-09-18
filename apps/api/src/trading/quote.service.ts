import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import {
  calculateFeeAmount,
  calculateMinOutputAmount,
  classifyPriceImpactBps,
  normalizeEvmAddress,
  PLATFORM_FEE_FALLBACK_BPS,
  resolveTierFeeBps,
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
  private readonly feeRecipient: string;
  private readonly chains: Map<number, ConfiguredChain>;

  constructor(
    private readonly safety: SafetyService,
    @Inject(SWAP_ROUTER) private readonly router: SwapRouter,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    // PLATFORM_FEE_BPS is no longer read here as of 2026-09-16 — the fee is now resolved
    // per-trade from PLATFORM_FEE_TIERS (see resolveAggregatorTierFeeBps below), not a
    // single static configured value. Same precedent as Solana's own
    // SOLANA_JUPITER_PLATFORM_FEE_BPS (see solana-quote.service.ts): the env var is left
    // defined (harmless if set) but has no effect on this service any more.
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

  /**
   * Resolves the fee tier for the OLDER, aggregator-embedded fee path (a non-USDC-quoted
   * market) — the router needs a `feeBps` upfront, before it can price the swap at all, so
   * the trade's USD size must be known before that call (unlike the guaranteed-USDC SELL
   * case in `createQuote`, which can wait until the real quote comes back). Two distinct
   * bases, by side:
   *
   *  - SELL: the input is already the base token being sold, and `market.priceUsd` (its
   *    cached, freshness-checked USD price — `SafetyService` already refused a stale one)
   *    prices it directly. No extra call.
   *  - BUY: the input is the *quote* token (e.g. WETH), which isn't USD-denominated and has
   *    no cached price of its own on `market`. A lightweight, fee-free pre-quote (mirrors
   *    `SolanaQuoteService#resolvePlatformFeeBps`'s own SELL-side pre-quote, locked in
   *    2026-09-13) discovers the base-token amount the real swap would produce;
   *    `market.priceUsd` then prices *that*.
   *
   * Falls back to `PLATFORM_FEE_FALLBACK_BPS` (the most expensive tier, never a cheaper
   * unconfirmed one — same rule Solana's own fallback follows) if `market.priceUsd` is
   * somehow null (shouldn't happen; `SafetyService` requires tracked liquidity) or the BUY
   * pre-quote itself comes back empty — the real, fee-bearing quote right after this call
   * will surface the same "no live quote" error to the caller either way.
   */
  private async resolveAggregatorTierFeeBps(
    params: CreateQuoteParams,
    market: TradableMarket,
    inputToken: { contractAddress: string; decimals: number | null },
    outputToken: { contractAddress: string; decimals: number | null },
    inputAmountRaw: bigint,
  ): Promise<number> {
    if (market.priceUsd === null) return PLATFORM_FEE_FALLBACK_BPS;
    const basePriceUsd = Number(market.priceUsd);

    if (params.side === 'SELL') {
      const usdAmount = Number(formatUnits(inputAmountRaw, inputToken.decimals!)) * basePriceUsd;
      return resolveTierFeeBps(usdAmount);
    }

    const preQuote = await this.router.getQuote({
      chainId: params.chainId,
      sellToken: inputToken.contractAddress,
      buyToken: outputToken.contractAddress,
      sellAmountRaw: inputAmountRaw.toString(),
      taker: normalizeEvmAddress(params.walletAddress),
      slippageBps: params.slippageBps,
      feeRecipient: null,
      feeBps: 0,
    });
    if (!preQuote) return PLATFORM_FEE_FALLBACK_BPS;
    const usdAmount = Number(formatUnits(BigInt(preQuote.buyAmountRaw), outputToken.decimals!)) * basePriceUsd;
    return resolveTierFeeBps(usdAmount);
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

    // PLATFORM_FEE_TIERS (see docs/TRADING.md#fees) is a %-of-trade-size schedule, so the
    // trade's real USD size must be known before a %-based fee can be picked. Three of the
    // four (guaranteed-USDC × side, aggregator × side) cases can resolve it right here,
    // before the real router call:
    //  - guaranteed-USDC BUY: the raw USDC input IS the trade's USD size — nothing to
    //    resolve beyond formatting it.
    //  - guaranteed-USDC SELL: the USD size is the swap's gross *output*, only known once
    //    the real router call below returns — resolved after it, further down.
    //  - aggregator (non-USDC-quoted market), either side: see
    //    resolveAggregatorTierFeeBps's own doc comment.
    const preRouterFeeBps = usesGuaranteedUsdcFee
      ? params.side === 'BUY'
        ? resolveTierFeeBps(Number(formatUnits(inputAmountRaw, inputToken.decimals!)))
        : 0 // unused for a guaranteed-USDC SELL — see appliedFeeBps below
      : await this.resolveAggregatorTierFeeBps(params, market, inputToken, outputToken, inputAmountRaw);

    // For a BUY, the fee comes off the USDC input *before* the swap is even quoted — the
    // router is only ever asked to price the remaining balance, so its own quote already
    // reflects exactly what the swap will produce.
    const preSwapFeeAmountRaw =
      usesGuaranteedUsdcFee && params.side === 'BUY' ? calculateFeeAmount(inputAmountRaw, preRouterFeeBps) : 0n;
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
      feeBps: usesGuaranteedUsdcFee ? 0 : preRouterFeeBps,
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

    // A guaranteed-USDC SELL's tier wasn't resolvable until now — the trade's USD size is
    // the gross USDC the swap actually produced, only known once the router has priced it.
    // Every other case already resolved its tier above, before this call.
    const appliedFeeBps =
      usesGuaranteedUsdcFee && params.side === 'SELL'
        ? resolveTierFeeBps(Number(formatUnits(grossBuyAmountRaw, market.quoteToken.decimals!)))
        : preRouterFeeBps;

    // For a SELL, the fee is a % of the (gross) USDC the swap is expected to produce —
    // taken via a *separate* transfer after the swap, never reducing the swap's own
    // on-chain output. Computed from the quoted amount, not a post-swap actual: the
    // resulting few-atoms-of-precision gap against real slippage is economically
    // meaningless and avoids a second backend round-trip to read the real receipt.
    const postSwapFeeAmountRaw =
      usesGuaranteedUsdcFee && params.side === 'SELL' ? calculateFeeAmount(grossBuyAmountRaw, appliedFeeBps) : 0n;

    const platformFeeAmountRaw = usesGuaranteedUsdcFee
      ? preSwapFeeAmountRaw + postSwapFeeAmountRaw // exactly one of these is nonzero, by side
      : routerQuote.feeAmountRaw
        ? BigInt(routerQuote.feeAmountRaw)
        : calculateFeeAmount(grossBuyAmountRaw, appliedFeeBps);

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
        platformFeeBps: appliedFeeBps,
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
      platformFeeBps: appliedFeeBps,
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
