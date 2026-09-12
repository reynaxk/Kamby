import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const ONE_INCH_BASE_URL = 'https://api.1inch.dev/swap/v6.1';

/** 1inch's own placeholder for native ETH in `src`/`dst` — never needs an ERC20 approval. */
const NATIVE_TOKEN_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/**
 * 1inch's Swap API (Classic Swap, v6.1) — one of two providers `MetaAggregatorSwapRouter`
 * races in parallel, see docs/TRADING.md#provider. All 1inch-specific request/response
 * shape lives here; nothing outside this file knows 1inch exists. Written against 1inch's
 * Swap API v6.1 `/swap` and `/approve/allowance` endpoints; re-verify field/param names
 * against 1inch's current docs before depending on this in production — see the
 * docs/TRADING.md note on why this couldn't be confirmed against a live key in this
 * environment.
 */
@Injectable()
export class OneInchSwapRouter implements SwapRouter {
  private readonly apiKey: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.apiKey = config.get('ONEINCH_API_KEY', { infer: true });
    this.logger.setContext('OneInchSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const startedAt = Date.now();
    const swapBody = await this.fetchSwap(request);
    if (!swapBody) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable or rejected the request');
      return null;
    }

    const parsed = parseOneInchSwap(swapBody, request);
    if (!parsed) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider response missing required fields');
      return null;
    }

    const requiresApproval = await this.needsApproval(request);
    if (requiresApproval === null) {
      // The swap itself priced fine, but we couldn't confirm allowance either way — never
      // guess on a flag that gates whether the UI shows an approval step for real money.
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not determine approval requirement');
      return null;
    }

    this.logger.info({ latencyMs: Date.now() - startedAt }, 'quote created');
    return {
      ...parsed,
      requiresApproval,
      approvalSpender: requiresApproval ? parsed.unsignedTx.to : null,
    };
  }

  private async fetchSwap(request: SwapRouterQuoteRequest): Promise<OneInchSwapResponse | null> {
    const params = new URLSearchParams({
      src: request.sellToken,
      dst: request.buyToken,
      amount: request.sellAmountRaw,
      from: request.taker,
      // 1inch takes slippage as a percentage (e.g. "0.5" for 0.5%), not bps.
      slippage: (request.slippageBps / 100).toString(),
      // We run our own allowance check separately (see needsApproval) and our own
      // pre-trade safety checks upstream — don't let 1inch's own balance/allowance
      // pre-flight reject a quote we'd otherwise price correctly.
      disableEstimate: 'true',
    });
    if (request.feeRecipient && request.feeBps > 0) {
      // Percentage, matching `slippage` above — see docs/TRADING.md#fees.
      params.set('fee', (request.feeBps / 100).toString());
      params.set('referrer', request.feeRecipient);
    }

    const url = `${ONE_INCH_BASE_URL}/${request.chainId}/swap?${params.toString()}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        this.logger.warn({ status: response.status }, 'swap endpoint rejected the request');
        return null;
      }
      return (await response.json()) as OneInchSwapResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'swap endpoint unreachable');
      return null;
    }
  }

  /** `null` means "couldn't determine" — distinct from `false`, so callers never treat an
   *  unknown allowance as "no approval needed" by accident. */
  private async needsApproval(request: SwapRouterQuoteRequest): Promise<boolean | null> {
    if (request.sellToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER) return false;

    const params = new URLSearchParams({ tokenAddress: request.sellToken, walletAddress: request.taker });
    const url = `${ONE_INCH_BASE_URL}/${request.chainId}/approve/allowance?${params.toString()}`;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` } });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'allowance check rejected by provider');
        return null;
      }
      const body = (await response.json()) as { allowance?: string };
      if (body.allowance === undefined) return null;
      try {
        return BigInt(body.allowance) < BigInt(request.sellAmountRaw);
      } catch {
        return null;
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'allowance check unreachable');
      return null;
    }
  }
}

/** The slice of 1inch's `/swap` response this adapter actually reads — deliberately not a
 *  full, strict type of 1inch's entire schema, since unrecognized extra fields are expected
 *  and harmless (1inch can add fields without this adapter needing an update). */
interface OneInchSwapResponse {
  dstAmount?: string;
  tx?: {
    to?: string;
    data?: string;
    value?: string;
    gas?: number | string | null;
    gasPrice?: string | null;
  };
}

/** The parts of `SwapRouterQuote` this file can fill in without knowing the approval
 *  outcome yet — `requiresApproval`/`approvalSpender` are layered on by the caller. */
function parseOneInchSwap(
  body: OneInchSwapResponse,
  request: SwapRouterQuoteRequest,
): (SwapRouterQuote & { unsignedTx: { to: string } }) | null {
  const tx = body.tx;
  if (!body.dstAmount || !tx?.to || !tx.data || tx.value === undefined) return null;

  return {
    provider: '1inch',
    providerQuoteId: null,
    buyAmountRaw: body.dstAmount,
    sellAmountRaw: '', // filled in by QuoteService from the request it already knows
    minBuyAmountRaw: applySlippageFloor(body.dstAmount, request.slippageBps),
    // 1inch's classic Swap API doesn't return a price-impact figure — honest `null`
    // rather than a fabricated one. See docs/TRADING.md#price-impact.
    priceImpactBps: null,
    // The router contract deducts the fee on-chain as part of the swap itself; 1inch's
    // `/swap` response doesn't echo the fee amount back for us to report separately.
    feeAmountRaw: null,
    requiresApproval: false, // placeholder — the caller overwrites this
    approvalSpender: null, // placeholder — the caller overwrites this
    unsignedTx: {
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: tx.gas != null ? String(tx.gas) : null,
      // 1inch's classic swap returns legacy `gasPrice`, not EIP-1559 fields.
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    },
  };
}

/** 1inch's router enforces this same bound on-chain via the `slippage` param we already
 *  sent — computed here (integer math, never floating point, per
 *  docs/TRADING.md#financial-precision) rather than trusting an uncertain response field. */
function applySlippageFloor(dstAmountRaw: string, slippageBps: number): string {
  const amount = BigInt(dstAmountRaw);
  const bps = BigInt(Math.round(slippageBps));
  return ((amount * (10000n - bps)) / 10000n).toString();
}
