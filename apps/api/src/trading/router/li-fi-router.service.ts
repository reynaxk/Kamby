import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, http, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const LI_FI_QUOTE_URL = 'https://li.quest/v1/quote';

/** LI.FI's own placeholder for native ETH in `fromToken`/`toToken` — never needs an ERC20
 *  approval. Some integrations instead use the zero address for the same purpose, so both
 *  are treated as "native" here rather than trusting a single convention. */
const NATIVE_TOKEN_PLACEHOLDERS = new Set([
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '0x0000000000000000000000000000000000000000',
]);

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
 * LI.FI's Quote API (`/v1/quote`) — see docs/TRADING.md#provider for why this provider and
 * exactly which endpoint. All LI.FI-specific request/response shape lives here; nothing
 * outside this file knows LI.FI exists. Written against LI.FI's Quote API as documented at
 * the time this was built; re-verify field/param names against LI.FI's current docs before
 * depending on this in production — see the docs/TRADING.md note on why this couldn't be
 * confirmed against a live key in this environment.
 *
 * Unlike 1inch/0x, LI.FI's response doesn't say whether an ERC-20 approval is still
 * needed, and there's no documented allowance-check endpoint to ask instead — so this
 * reads the wallet's actual on-chain allowance directly (same RPC this app already uses
 * for transaction-receipt reads), rather than guessing on a flag that gates whether the UI
 * shows an approval step before real money moves.
 */
@Injectable()
export class LiFiSwapRouter implements SwapRouter {
  private readonly apiKey: string;
  private readonly integrator: string;
  /** One client per configured chain, built once at construction — never per-request,
   *  which would defeat each client's own connection reuse. */
  private readonly chainClients: Map<number, PublicClient>;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.apiKey = config.get('LIFI_API_KEY', { infer: true });
    this.integrator = config.get('LIFI_INTEGRATOR', { infer: true });
    this.chainClients = new Map(
      getConfiguredChains((key) => config.get(key, { infer: true })).map((chain) => [
        chain.chainId,
        createPublicClient({ transport: http(chain.rpcUrl) }),
      ]),
    );
    this.logger.setContext('LiFiSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const startedAt = Date.now();
    const body = await this.fetchQuote(request);
    if (!body) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable or rejected the request');
      return null;
    }

    const parsed = parseLiFiQuote(body);
    if (!parsed) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider response missing required fields');
      return null;
    }

    const requiresApproval = await this.needsApproval(request, parsed.unsignedTx.to);
    if (requiresApproval === null) {
      // The quote itself priced fine, but we couldn't confirm allowance either way — never
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

  private async fetchQuote(request: SwapRouterQuoteRequest): Promise<LiFiQuoteResponse | null> {
    const params = new URLSearchParams({
      fromChain: String(request.chainId),
      toChain: String(request.chainId), // Kamby only ever trades within one chain per market.
      fromToken: request.sellToken,
      toToken: request.buyToken,
      fromAmount: request.sellAmountRaw,
      fromAddress: request.taker,
      // LI.FI takes slippage as a decimal fraction (e.g. 0.005 for 0.5%), not bps.
      slippage: (request.slippageBps / 10000).toString(),
      integrator: this.integrator,
    });
    if (request.feeRecipient && request.feeBps > 0) {
      // Decimal fraction, matching `slippage` above. The recipient itself isn't a
      // per-request param — it's whatever wallet is registered against `integrator` in
      // LI.FI's partner portal — see docs/TRADING.md#fees.
      params.set('fee', (request.feeBps / 10000).toString());
    }

    const url = `${LI_FI_QUOTE_URL}?${params.toString()}`;
    try {
      const response = await fetch(url, { headers: { 'x-lifi-api-key': this.apiKey } });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        this.logger.warn({ status: response.status }, 'quote endpoint rejected the request');
        return null;
      }
      return (await response.json()) as LiFiQuoteResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'quote endpoint unreachable');
      return null;
    }
  }

  /** `null` means "couldn't determine" — distinct from `false`, so callers never treat an
   *  unknown allowance as "no approval needed" by accident. A `request.chainId` this
   *  process has no client for is treated exactly the same way — never silently answered
   *  from a different chain's client. */
  private async needsApproval(request: SwapRouterQuoteRequest, spender: string): Promise<boolean | null> {
    if (NATIVE_TOKEN_PLACEHOLDERS.has(request.sellToken.toLowerCase())) return false;

    const client = this.chainClients.get(request.chainId);
    if (!client) {
      this.logger.error({ chainId: request.chainId }, 'no chain client configured for this chainId');
      return null;
    }

    try {
      const allowance = await client.readContract({
        address: request.sellToken as `0x${string}`,
        abi: erc20AllowanceAbi,
        functionName: 'allowance',
        args: [request.taker as `0x${string}`, spender as `0x${string}`],
      });
      return allowance < BigInt(request.sellAmountRaw);
    } catch (error) {
      this.logger.warn({ err: error }, 'on-chain allowance read failed');
      return null;
    }
  }
}

/** The slice of LI.FI's `/quote` response this adapter actually reads — deliberately not a
 *  full, strict type of LI.FI's entire schema, since unrecognized extra fields are expected
 *  and harmless (LI.FI can add fields without this adapter needing an update). */
interface LiFiQuoteResponse {
  estimate?: {
    toAmount?: string;
    toAmountMin?: string;
  };
  transactionRequest?: {
    to?: string;
    data?: string;
    value?: string;
    gasLimit?: string | null;
    gasPrice?: string | null;
  };
}

/** The parts of `SwapRouterQuote` this file can fill in without knowing the approval
 *  outcome yet — `requiresApproval`/`approvalSpender` are layered on by the caller. */
function parseLiFiQuote(body: LiFiQuoteResponse): (SwapRouterQuote & { unsignedTx: { to: string } }) | null {
  const est = body.estimate;
  const tx = body.transactionRequest;
  if (!est?.toAmount || !est.toAmountMin || !tx?.to || !tx.data || tx.value === undefined) return null;

  return {
    provider: 'li.fi',
    providerQuoteId: null,
    buyAmountRaw: est.toAmount,
    sellAmountRaw: '', // filled in by QuoteService from the request it already knows
    // LI.FI computes this from the route's actual liquidity, not naive slippage math —
    // used as-is rather than recomputed. See docs/TRADING.md#quote-system for the
    // downstream sanity check against the requested `slippageBps`.
    minBuyAmountRaw: est.toAmountMin,
    // LI.FI's Quote API doesn't return a price-impact figure — honest `null` rather than a
    // fabricated one. See docs/TRADING.md#price-impact.
    priceImpactBps: null,
    // The router contract deducts the fee on-chain as part of the swap itself; LI.FI's
    // `/quote` response doesn't echo the fee amount back for us to report separately.
    feeAmountRaw: null,
    requiresApproval: false, // placeholder — the caller overwrites this
    approvalSpender: null, // placeholder — the caller overwrites this
    unsignedTx: {
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gas: tx.gasLimit ?? null,
      // LI.FI's response has historically used legacy `gasPrice`, not EIP-1559 fields.
      maxFeePerGas: null,
      maxPriorityFeePerGas: null,
    },
  };
}
