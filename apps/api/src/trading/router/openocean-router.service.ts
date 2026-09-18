import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEvmTransport } from '@kamby/chain-adapters';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const OPENOCEAN_BASE_URL = 'https://open-api.openocean.finance/v4';

/** OpenOcean's own per-chain URL path segment — confirmed 'bsc' for BNB Chain against
 *  OpenOcean's current docs (https://docs.openocean.finance/docs/swap-api/v4), 2026-09-15.
 *  Kamby's own chain slug ('bnb') deliberately doesn't need to match this; unlike
 *  KyberSwapRouter (whose slugs happen to line up with Kamby's own), OpenOcean's chain
 *  naming is looked up explicitly here instead of assumed to match. */
const OPENOCEAN_CHAIN_SLUGS: Partial<Record<number, string>> = { 56: 'bsc' };

/** Same reasoning as KyberSwapRouter's identical constant — a real, honest per-call ceiling,
 *  not a marketing SLA number. Only one HTTP call here (OpenOcean's /swap endpoint prices
 *  and builds the transaction in one shot, unlike KyberSwap's two-step routes/route-build
 *  flow), so this is the router's entire network budget, not split across multiple calls. */
const FETCH_TIMEOUT_MS = 4000;

/** OpenOcean's docs don't explicitly confirm this for native BNB — this is the de facto
 *  standard placeholder every other aggregator integrated here (KyberSwap, and 0x/1inch
 *  before it) uses for "the chain's native token, not an ERC-20." Re-verify against a live
 *  response before depending on this for an actual native-BNB trade; see this class's own
 *  doc comment for the general "not verified against a live key" caveat. */
const NATIVE_TOKEN_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const erc20AllowanceAbi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/**
 * OpenOcean's Swap API — built 2026-09-15 as BNB Chain's intended execution provider, but
 * NOT actually routed to as of 2026-09-17 — see MultiChainSwapRouter's own doc comment.
 * The first real BNB trade attempt found `open-api.openocean.finance` returning a
 * Cloudflare bot-challenge (HTTP 403) for every request, from multiple independent
 * networks, with or without a browser User-Agent — an external block this class's plain
 * `fetch()` calls cannot pass, not a bug in the request shape below. BNB Chain now routes
 * through KyberSwap instead (confirmed live-working). Left in place, not deleted, in case a
 * real, registered OpenOcean API key later grants access past that challenge — nothing
 * about the integration itself is known to be wrong, only that it's currently unreachable
 * without one. Verified against OpenOcean's own current docs
 * (https://docs.openocean.finance/docs/swap-api/v4) on 2026-09-15 — NOT against a live
 * key/response, same caveat every other aggregator integration in this codebase carries
 * (LI.FI/1inch historically, KyberSwap currently); re-verify field names before depending on
 * this further if OpenOcean's API changes.
 *
 * One call, not two, unlike KyberSwapRouter: `GET /v4/bsc/swap` with `account` set prices
 * the trade *and* returns the built, signable transaction (`to`/`data`/`value`) in the same
 * response — OpenOcean's docs describe a separate quote-only `/quote` endpoint too, but this
 * router has no use for it, the same way JupiterQuoteService's main path skips its own
 * quote-only call except for the one case (a SELL's fee-tier discovery) that specifically
 * needs price without a built transaction.
 *
 * Two real, load-bearing gaps flagged rather than guessed past:
 * - `price_impact` is returned but its exact numeric convention (fraction vs. percent,
 *   sign) isn't confirmed — left `null`, never fabricated, same choice KyberSwapRouter made
 *   for the identical reason (its own response doesn't carry the figure at all).
 * - OpenOcean's docs state `referrerFee` (this router's carrier for Kamby's platform fee on
 *   non-USDC-quoted markets — see QuoteService's own doc comment on the guaranteed-USDC-fee
 *   path this is the fallback for) "serves purely as a tracking tool" if no fee has been set
 *   up with OpenOcean out-of-band. Whether Kamby's referrer address is actually registered
 *   for fee collection has NOT been confirmed — this needs a real test trade against a
 *   non-USDC-quoted BNB Chain market to verify the fee is actually collected, not just
 *   tracked, before this path is trusted for real revenue.
 */
@Injectable()
export class OpenOceanRouter implements SwapRouter {
  /** One client per configured chain this router might be asked about — same pattern and
   *  same reasoning as KyberSwapRouter's own chainClients map (OpenOcean's API doesn't
   *  expose an allowance-check endpoint either, and this doubles as the source for a real,
   *  current gas price OpenOcean's /swap endpoint requires). */
  private readonly chainClients: Map<number, PublicClient>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    const chains = getConfiguredChains((key) => config.get(key, { infer: true }));
    this.chainClients = new Map(
      chains
        .filter((c) => OPENOCEAN_CHAIN_SLUGS[c.chainId] !== undefined)
        .map((c) => [c.chainId, createPublicClient({ transport: createEvmTransport(c.rpcUrl, c.rpcUrlFallback) })]),
    );
    this.logger.setContext('OpenOceanRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const startedAt = Date.now();
    const chainSlug = OPENOCEAN_CHAIN_SLUGS[request.chainId];
    const client = this.chainClients.get(request.chainId);
    if (!chainSlug || !client) {
      this.logger.warn({ chainId: request.chainId }, 'quote failure: no OpenOcean chain slug configured for this chainId');
      return null;
    }

    const gasPrice = await this.readGasPrice(client);
    if (gasPrice === null) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not read a current gas price');
      return null;
    }

    const swap = await this.fetchSwap(chainSlug, gasPrice, request);
    if (!swap) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable or rejected the swap request');
      return null;
    }

    const requiresApproval = await this.needsApproval(request, swap.to);
    if (requiresApproval === null) {
      // The swap itself priced fine, but we couldn't confirm allowance either way — never
      // guess on a flag that gates whether the UI shows an approval step for real money.
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not determine approval requirement');
      return null;
    }

    this.logger.info({ latencyMs: Date.now() - startedAt }, 'quote created');
    return {
      provider: 'openocean',
      providerQuoteId: null,
      buyAmountRaw: swap.outAmount,
      sellAmountRaw: '', // filled in by QuoteService from the request it already knows
      minBuyAmountRaw: swap.minOutAmount,
      // See this class's own doc comment on why price_impact is never parsed from
      // OpenOcean's response — its numeric convention isn't confirmed.
      priceImpactBps: null,
      // OpenOcean's /swap response doesn't echo the fee amount it actually deducted back
      // separately — same gap KyberSwap's route/build response has.
      feeAmountRaw: null,
      requiresApproval,
      approvalSpender: requiresApproval ? swap.to : null,
      unsignedTx: {
        to: swap.to,
        data: swap.data,
        value: swap.value ?? '0',
        gas: swap.estimatedGas !== undefined && swap.estimatedGas !== null ? String(swap.estimatedGas) : null,
        // OpenOcean returns a legacy gasPrice, not EIP-1559 fields — same as KyberSwap's
        // build response. Deliberately unused: UnsignedTransactionSchema has no slot for a
        // dapp-supplied legacy gas price, and every wallet already determines its own gas
        // price live at signing time rather than trusting one a quote request supplied
        // minutes earlier.
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      },
    };
  }

  private async readGasPrice(client: PublicClient): Promise<string | null> {
    try {
      return (await client.getGasPrice()).toString();
    } catch (error) {
      this.logger.warn({ err: error }, 'gas price read unreachable');
      return null;
    }
  }

  private async fetchSwap(chainSlug: string, gasPrice: string, request: SwapRouterQuoteRequest): Promise<OpenOceanSwapData | null> {
    const params = new URLSearchParams({
      inTokenAddress: request.sellToken,
      outTokenAddress: request.buyToken,
      amountDecimals: request.sellAmountRaw,
      gasPriceDecimals: gasPrice,
      account: request.taker,
      // OpenOcean's own documented range is 0.05-50 (a percentage, not bps) — converted
      // here, never re-clamped: an out-of-range value fails the request cleanly (returns
      // null below) rather than silently being coerced into range.
      slippage: (request.slippageBps / 100).toString(),
      ...(request.feeRecipient && request.feeBps > 0
        ? { referrer: request.feeRecipient, referrerFee: (request.feeBps / 100).toString() }
        : {}),
    });
    const url = `${OPENOCEAN_BASE_URL}/${chainSlug}/swap?${params.toString()}`;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        this.logger.warn({ status: response.status }, 'swap endpoint rejected the request');
        return null;
      }
      const body = (await response.json()) as OpenOceanSwapResponse;
      if (!body.data) {
        this.logger.warn({ code: body.code }, 'swap endpoint returned no route data');
        return null;
      }
      return body.data;
    } catch (error) {
      this.logger.warn({ err: error }, 'swap endpoint unreachable');
      return null;
    }
  }

  /** Same on-chain-read approach as KyberSwapRouter#needsApproval — OpenOcean's API has no
   *  documented allowance-check endpoint either, so this reads the wallet's actual allowance
   *  directly via viem rather than guessing on a flag that gates whether the UI shows an
   *  approval step before real money moves. */
  private async needsApproval(request: SwapRouterQuoteRequest, spender: string): Promise<boolean | null> {
    if (request.sellToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER) return false;

    const client = this.chainClients.get(request.chainId);
    if (!client) return null;
    try {
      const allowance = await client.readContract({
        address: request.sellToken as `0x${string}`,
        abi: erc20AllowanceAbi,
        functionName: 'allowance',
        args: [request.taker as `0x${string}`, spender as `0x${string}`],
      });
      return allowance < BigInt(request.sellAmountRaw);
    } catch (error) {
      this.logger.warn({ err: error }, 'allowance check unreachable');
      return null;
    }
  }
}

/** The slice of OpenOcean's `/swap` response this adapter actually reads — deliberately not
 *  a full, strict type of its entire schema. */
interface OpenOceanSwapData {
  outAmount: string;
  minOutAmount: string;
  to: string;
  data: string;
  value?: string;
  estimatedGas?: string | number | null;
}

interface OpenOceanSwapResponse {
  code: number;
  data?: OpenOceanSwapData;
}
