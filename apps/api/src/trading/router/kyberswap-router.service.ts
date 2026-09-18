import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEvmTransport } from '@kamby/chain-adapters';
import { PinoLogger } from 'nestjs-pino';
import { createPublicClient, type PublicClient } from 'viem';
import { getConfiguredChains, type Env } from '../../config/env';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

const KYBERSWAP_BASE_URL = 'https://aggregator-api.kyberswap.com';

/** Applied to each of the two calls independently (not one combined budget) — a real,
 *  honest ceiling for "how long a user will wait for a quote," not a marketing SLA number.
 *  Same value the retired `MetaAggregatorSwapRouter` used for its LI.FI/1inch race; revisit
 *  once this has run against real KyberSwap traffic. */
const FETCH_TIMEOUT_MS = 4000;

/** KyberSwap's own placeholder for native ETH in tokenIn/tokenOut — same convention
 *  1inch/LI.FI already used, never needs an ERC20 approval. */
const NATIVE_TOKEN_PLACEHOLDER = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/** Where Kamby's own chain slug genuinely doesn't match KyberSwap's URL path segment —
 *  confirmed live 2026-09-17 against the real API (`.../bnb/...` 404s, `.../bsc/...`
 *  returns a real route) while diagnosing why BNB Chain trades were failing. Checked
 *  before falling back to the chain's own slug below; every other configured chain so far
 *  (Base, Arbitrum) has genuinely matched and needs no entry here. */
const KYBERSWAP_CHAIN_SLUG_OVERRIDES: Partial<Record<number, string>> = { 56: 'bsc' };

/** How long a read allowance is trusted before this router re-checks on-chain — see
 *  `allowanceCache`'s own doc comment. 5 minutes: long enough to skip the RPC round-trip
 *  for the common case (a user adjusting an amount, or re-quoting, well within one sitting)
 *  short enough that a genuinely revoked approval is only ever stale for a bounded window,
 *  not indefinitely. */
const ALLOWANCE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Crude, deliberately simple bound on the cache's memory footprint — see
 *  `allowanceCache`'s own doc comment. Not an LRU (no extra dependency for what's a Phase-1
 *  scale concern): once the map would grow past this, it's cleared outright rather than
 *  evicted entry-by-entry. Costs a few extra RPC reads right after a clear, never
 *  correctness — the next check for each key just falls through to a real on-chain read. */
const ALLOWANCE_CACHE_MAX_ENTRIES = 10_000;

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
 * KyberSwap's Aggregator API — Kamby's sole EVM execution provider as of 2026-09-14,
 * replacing the LI.FI/1inch meta-aggregator race (see git history and
 * docs/TRADING.md#provider for why). Verified against KyberSwap's own current docs
 * (https://docs.kyberswap.com/developer-guide/aggregator-api/aggregator-api-specification/evm-swaps)
 * on 2026-09-14 — NOT against a live key/response, same caveat LI.FI/1inch always carried;
 * re-verify field names before depending on this further if KyberSwap's API changes.
 *
 * Two calls, not one, unlike 1inch/LI.FI's single-call shape: `GET .../api/v1/routes`
 * prices the trade into a `routeSummary`, then `POST .../api/v1/route/build` turns that
 * same `routeSummary` into encoded calldata. Fee collection
 * (`chargeFeeBy`/`feeAmount`/`isInBps`/`feeReceiver`) and slippage protection are both
 * applied on the second call, since that's what actually produces the transaction the
 * wallet signs — the first call is price discovery only.
 *
 * No API key required: KyberSwap's docs state the API needs no authentication, only an
 * `X-Client-Id` header (a plain identifying string, not a secret) for rate-limit
 * prioritization — see `KYBERSWAP_CLIENT_ID` in config/env.ts.
 */
@Injectable()
export class KyberSwapRouter implements SwapRouter {
  private readonly clientId: string;
  /** Kamby's own chain slugs ('base', 'arbitrum') happen to match KyberSwap's own URL
   *  path segments exactly — confirmed against KyberSwap's supported-chains list, not
   *  assumed to line up. BNB Chain ('bnb' in Kamby, 'bsc' in KyberSwap's own URLs) does
   *  NOT — see KYBERSWAP_CHAIN_SLUG_OVERRIDES above. */
  private readonly chainSlugs: Map<number, string>;
  /** One client per configured chain, built once at construction, used only for the
   *  on-chain allowance read below — same pattern and same reasoning as LiFiSwapRouter's
   *  own client map (KyberSwap's API doesn't expose an allowance-check endpoint either). */
  private readonly chainClients: Map<number, PublicClient>;
  /** Real speedup added 2026-09-17: every quote — including ones fired just from a user
   *  adjusting the typed amount, long before they ever click "Review" — re-checked the
   *  wallet's on-chain allowance from scratch, even though `TradePanel.tsx`'s infinite-
   *  approval pattern (see its own doc comment) means a wallet that has traded a token
   *  once is almost always already approved for every later trade of it. Caches the last
   *  *observed* allowance per (chain, owner, token, spender) — a fresh RPC read only
   *  happens when there's no cache entry, it's past `ALLOWANCE_CACHE_TTL_MS`, or the cached
   *  allowance genuinely isn't enough for the *current* request's amount, so this can only
   *  ever skip a check that would have come back "already sufficient" anyway; it never
   *  invents a "no approval needed" the last real read didn't actually support. The one
   *  edge case this accepts: a wallet that revokes its approval mid-cache-window gets a
   *  stale "no approval needed" for up to `ALLOWANCE_CACHE_TTL_MS` — the swap transaction
   *  itself then simply reverts (a wasted-gas failure, not a fund-loss risk), the same
   *  class of acceptable tradeoff `QuoteService`'s own guaranteed-fee math already makes
   *  elsewhere for an economically negligible gap. Per-process (this is a NestJS singleton,
   *  not shared across replicas or persisted) — a cache miss just means the old, always-
   *  correct RPC path runs, never an incorrect result. */
  private readonly allowanceCache = new Map<string, { allowance: bigint; cachedAt: number }>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.clientId = config.get('KYBERSWAP_CLIENT_ID', { infer: true });
    const chains = getConfiguredChains((key) => config.get(key, { infer: true }));
    this.chainSlugs = new Map(chains.map((c) => [c.chainId, KYBERSWAP_CHAIN_SLUG_OVERRIDES[c.chainId] ?? c.slug]));
    this.chainClients = new Map(
      chains.map((c) => [c.chainId, createPublicClient({ transport: createEvmTransport(c.rpcUrl, c.rpcUrlFallback) })]),
    );
    this.logger.setContext('KyberSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const startedAt = Date.now();
    const chainSlug = this.chainSlugs.get(request.chainId);
    if (!chainSlug) {
      this.logger.warn({ chainId: request.chainId }, 'quote failure: no KyberSwap chain slug configured for this chainId');
      return null;
    }

    const route = await this.fetchRoute(chainSlug, request);
    if (!route) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable or rejected the route request');
      return null;
    }

    const built = await this.buildTransaction(chainSlug, route, request);
    if (!built) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not build the swap transaction');
      return null;
    }

    const requiresApproval = await this.needsApproval(request, built.routerAddress);
    if (requiresApproval === null) {
      // The swap itself priced fine, but we couldn't confirm allowance either way — never
      // guess on a flag that gates whether the UI shows an approval step for real money.
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not determine approval requirement');
      return null;
    }

    this.logger.info({ latencyMs: Date.now() - startedAt }, 'quote created');
    return {
      provider: 'kyberswap',
      providerQuoteId: null,
      buyAmountRaw: built.amountOut,
      sellAmountRaw: '', // filled in by QuoteService from the request it already knows
      minBuyAmountRaw: applySlippageFloor(built.amountOut, request.slippageBps),
      // KyberSwap's routeSummary/route-build response doesn't return a price-impact
      // figure — honest null, never fabricated. See docs/TRADING.md#price-impact.
      priceImpactBps: null,
      // The router contract deducts the fee on-chain as part of the swap itself;
      // KyberSwap's /route/build response doesn't echo the fee amount back separately.
      feeAmountRaw: null,
      requiresApproval,
      approvalSpender: requiresApproval ? built.routerAddress : null,
      unsignedTx: {
        to: built.routerAddress,
        data: built.data,
        value: built.transactionValue ?? '0',
        gas: built.gas ?? null,
        // KyberSwap's build response doesn't return EIP-1559 fee fields.
        maxFeePerGas: null,
        maxPriorityFeePerGas: null,
      },
    };
  }

  private async fetchRoute(chainSlug: string, request: SwapRouterQuoteRequest): Promise<KyberRouteData | null> {
    const params = new URLSearchParams({
      tokenIn: request.sellToken,
      tokenOut: request.buyToken,
      amountIn: request.sellAmountRaw,
    });
    const url = `${KYBERSWAP_BASE_URL}/${chainSlug}/api/v1/routes?${params.toString()}`;
    try {
      const response = await fetch(url, { headers: { 'x-client-id': this.clientId }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        this.logger.warn({ status: response.status }, 'routes endpoint rejected the request');
        return null;
      }
      const body = (await response.json()) as KyberRouteResponse;
      return body.data ?? null;
    } catch (error) {
      this.logger.warn({ err: error }, 'routes endpoint unreachable');
      return null;
    }
  }

  private async buildTransaction(chainSlug: string, route: KyberRouteData, request: SwapRouterQuoteRequest): Promise<KyberBuildData | null> {
    const url = `${KYBERSWAP_BASE_URL}/${chainSlug}/api/v1/route/build`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-client-id': this.clientId },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          routeSummary: route.routeSummary,
          sender: request.taker,
          recipient: request.taker,
          slippageTolerance: request.slippageBps,
          ...(request.feeRecipient && request.feeBps > 0
            ? { chargeFeeBy: 'currency_in', feeAmount: String(request.feeBps), isInBps: true, feeReceiver: request.feeRecipient }
            : {}),
        }),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'route/build endpoint rejected the request');
        return null;
      }
      const body = (await response.json()) as KyberBuildResponse;
      return body.data ?? null;
    } catch (error) {
      this.logger.warn({ err: error }, 'route/build endpoint unreachable');
      return null;
    }
  }

  /** Same on-chain-read approach as LiFiSwapRouter#needsApproval — KyberSwap's API has no
   *  documented allowance-check endpoint either, so this reads the wallet's actual
   *  allowance directly via viem rather than guessing on a flag that gates whether the UI
   *  shows an approval step before real money moves. Checks `allowanceCache` first — see
   *  that field's own doc comment for exactly what it can and can't skip. */
  private async needsApproval(request: SwapRouterQuoteRequest, spender: string): Promise<boolean | null> {
    if (request.sellToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER) return false;

    const sellAmountRaw = BigInt(request.sellAmountRaw);
    const cacheKey = `${request.chainId}:${request.taker.toLowerCase()}:${request.sellToken.toLowerCase()}:${spender.toLowerCase()}`;
    const cached = this.allowanceCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ALLOWANCE_CACHE_TTL_MS && cached.allowance >= sellAmountRaw) {
      return false;
    }

    const client = this.chainClients.get(request.chainId);
    if (!client) return null;
    try {
      const allowance = await client.readContract({
        address: request.sellToken as `0x${string}`,
        abi: erc20AllowanceAbi,
        functionName: 'allowance',
        args: [request.taker as `0x${string}`, spender as `0x${string}`],
      });
      if (this.allowanceCache.size >= ALLOWANCE_CACHE_MAX_ENTRIES) this.allowanceCache.clear();
      this.allowanceCache.set(cacheKey, { allowance, cachedAt: Date.now() });
      return allowance < sellAmountRaw;
    } catch (error) {
      this.logger.warn({ err: error }, 'allowance check unreachable');
      return null;
    }
  }
}

/** The slice of KyberSwap's `/routes` response this adapter actually reads — deliberately
 *  not a full, strict type of its entire schema; `routeSummary` itself is passed straight
 *  back to `/route/build` unmodified, so it's kept as `unknown` rather than typed field by
 *  field here (this file never reads inside it directly). */
interface KyberRouteData {
  routeSummary: unknown;
  routerAddress: string;
}

interface KyberRouteResponse {
  code: number;
  data?: KyberRouteData;
}

/** The slice of KyberSwap's `/route/build` response this adapter actually reads. */
interface KyberBuildData {
  amountOut: string;
  data: string;
  routerAddress: string;
  transactionValue?: string;
  gas?: string;
}

interface KyberBuildResponse {
  code: number;
  data?: KyberBuildData;
}

/** KyberSwap's router enforces this same bound on-chain via the `slippageTolerance` we
 *  already sent — computed here (integer math, never floating point, per
 *  docs/TRADING.md#financial-precision) rather than trusting an uncertain response field. */
function applySlippageFloor(buyAmountRaw: string, slippageBps: number): string {
  const amount = BigInt(buyAmountRaw);
  const bps = BigInt(Math.round(slippageBps));
  return ((amount * (10000n - bps)) / 10000n).toString();
}
