import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';

// Jupiter's old free/keyless `quote-api.jup.ag/v6/*` domain no longer resolves at all
// (confirmed live: DNS lookup failure, not a rate limit or rejection) — Jupiter
// restructured onto `api.jup.ag`, which requires an `x-api-key` even on its free tier
// (1 req/sec). See docs/TRADING.md#solana.
const JUPITER_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';
const JUPITER_SWAP_URL = 'https://api.jup.ag/swap/v1/swap';

export interface JupiterQuoteParams {
  inputMint: string;
  outputMint: string;
  /** Raw integer units (pre-decimals), as a string — same convention as the EVM side'
   *  quote flow (see docs/TRADING.md#financial-precision). Never a JS number. */
  amountRaw: string;
  slippageBps: number;
  /** Who the built swap transaction's instructions authorize as the swapper — the
   *  transaction still needs *that* wallet's own signature before it's valid; this
   *  service never signs anything, see docs/WALLET_SECURITY.md. */
  userPublicKey: string;
  /** In basis points — see QuoteService's own PLATFORM_FEE_BPS for the EVM-side
   *  equivalent. Passed on the /quote call, per Jupiter's docs. */
  platformFeeBps: number;
  /** A USDC Associated Token Account owned by the treasury — NOT the treasury's raw
   *  wallet address. Jupiter requires `feeAccount`'s mint to be part of the swap pair;
   *  since the input mint here is always USDC, this must be a USDC ATA. Passed on the
   *  /swap call, per Jupiter's docs. */
  feeAccount: string;
  /** Lamports for Jupiter's own built-in Jito tip instruction — confirmed live 2026-09-13
   *  against Jupiter's current docs: passing `prioritizationFeeLamports.jitoTipLamports`
   *  on /swap makes Jupiter build the tip instruction (to one of Jito's real, rotating tip
   *  accounts) directly into the returned transaction — this service never constructs that
   *  instruction itself. `undefined`/0 omits the field entirely, same as platformFeeBps'
   *  own >0 gating below. Note: the tip instruction alone does nothing until the *signed*
   *  transaction is actually submitted through Jito's own endpoint
   *  (mainnet.block-engine.jito.wtf) rather than a normal RPC — that broadcast-path change
   *  is a separate, not-yet-made frontend change; see docs/TRADING.md#solana. */
  jitoTipLamports?: number;
}

export interface JupiterQuoteResult {
  inputMint: string;
  outputMint: string;
  inputAmountRaw: string;
  outputAmountRaw: string;
  /** The floor output amount the built transaction actually enforces on-chain, after
   *  slippageBps — Jupiter's own `otherAmountThreshold`. */
  minOutputAmountRaw: string;
  /** Jupiter's own price-impact estimate, as basis points — `null` if it didn't return
   *  one, never fabricated. */
  priceImpactBps: number | null;
  platformFeeBps: number;
  platformFeeAmountRaw: string | null;
  /** Base64-encoded, serialized, unsigned `VersionedTransaction` — see
   *  docs/WALLET_SECURITY.md. This service has no mechanism to sign it. */
  unsignedTxBase64: string;
}

/**
 * Jupiter's Swap API (`api.jup.ag/swap/v1/{quote,swap}`) — see docs/TRADING.md#solana for
 * why this provider. Unlike the EVM `SwapRouter` interface
 * (`apps/api/src/trading/router/swap-router.interface.ts`), this is quote *and*
 * transaction-building combined into one call — Jupiter's `/swap` endpoint is what
 * actually produces the serialized transaction the client signs, so splitting "get a
 * price" from "build the transaction" the way the EVM flow does would mean two round
 * trips for no benefit here. This is deliberately not a `SwapRouter` implementation: that
 * interface returns a quote only and was never meant to also drive transaction
 * construction — see the multi-chain/Solana planning notes for why a shared interface
 * was rejected rather than forced.
 *
 * The base URL and `x-api-key` requirement were only confirmed live on 2026-09-12, after
 * the originally-integrated `quote-api.jup.ag/v6/*` domain (keyless, no longer requiring
 * the Referral Program as of Jan 2025) stopped resolving in production — a real DNS
 * failure, not a rate limit or rejection. Jupiter has restructured this API before and
 * will likely again; re-verify against Jupiter's current docs
 * (https://developers.jup.ag) before depending on this further, same caveat
 * `LiFiSwapRouter` carries for LI.FI.
 */
@Injectable()
export class JupiterQuoteService {
  private readonly apiKey: string | null;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.apiKey = getSolanaConfig((key) => config.get(key, { infer: true }))?.jupiterApiKey ?? null;
    this.logger.setContext('JupiterQuoteService');
  }

  async getQuote(params: JupiterQuoteParams): Promise<JupiterQuoteResult | null> {
    if (this.apiKey === null) {
      this.logger.error('no Jupiter API key configured — cannot request a quote');
      return null;
    }

    const startedAt = Date.now();
    const quote = await this.fetchQuote(params);
    if (!quote) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: provider unreachable or rejected the request');
      return null;
    }

    const swap = await this.fetchSwapTransaction(quote, params);
    if (!swap) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: could not build the swap transaction');
      return null;
    }

    this.logger.info({ latencyMs: Date.now() - startedAt }, 'quote created');
    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inputAmountRaw: quote.inAmount,
      outputAmountRaw: quote.outAmount,
      minOutputAmountRaw: quote.otherAmountThreshold,
      priceImpactBps: parsePriceImpactBps(quote.priceImpactPct),
      platformFeeBps: params.platformFeeBps,
      platformFeeAmountRaw: quote.platformFee?.amount ?? null,
      unsignedTxBase64: swap.swapTransaction,
    };
  }

  /**
   * A lighter-weight quote-only call — no swap transaction is built, and no platform fee is
   * requested (Jupiter's own fee accounting would otherwise shrink the output this exists
   * to measure). Used by `SolanaQuoteService` to discover a SELL trade's USD size — the
   * *output* side, unknown until Jupiter actually prices the trade — before it knows which
   * fee tier applies; a BUY's size is already known upfront (the input is always USDC), so
   * this is never needed there. See `SolanaQuoteService#resolvePlatformFeeBps`.
   */
  async getEstimatedOutputRaw(params: { inputMint: string; outputMint: string; amountRaw: string; slippageBps: number }): Promise<string | null> {
    if (this.apiKey === null) return null;
    const quote = await this.fetchQuote({ ...params, platformFeeBps: 0 });
    return quote?.outAmount ?? null;
  }

  // Only reads inputMint/outputMint/amountRaw/slippageBps/platformFeeBps — narrowed to
  // exactly those (rather than the full JupiterQuoteParams, which also carries
  // userPublicKey/feeAccount for fetchSwapTransaction's own use) so getEstimatedOutputRaw
  // above never has to fake values for fields this method doesn't actually touch.
  private async fetchQuote(
    params: Pick<JupiterQuoteParams, 'inputMint' | 'outputMint' | 'amountRaw' | 'slippageBps' | 'platformFeeBps'>,
  ): Promise<JupiterQuoteResponse | null> {
    const query = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: params.amountRaw,
      slippageBps: params.slippageBps.toString(),
    });
    if (params.platformFeeBps > 0) query.set('platformFeeBps', params.platformFeeBps.toString());

    const url = `${JUPITER_QUOTE_URL}?${query.toString()}`;
    try {
      const response = await fetch(url, { headers: { 'x-api-key': this.apiKey! } });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        this.logger.warn({ status: response.status }, 'quote endpoint rejected the request');
        return null;
      }
      return (await response.json()) as JupiterQuoteResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'quote endpoint unreachable');
      return null;
    }
  }

  private async fetchSwapTransaction(
    quote: JupiterQuoteResponse,
    params: JupiterQuoteParams,
  ): Promise<JupiterSwapResponse | null> {
    try {
      const response = await fetch(JUPITER_SWAP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey! },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: params.userPublicKey,
          feeAccount: params.platformFeeBps > 0 ? params.feeAccount : undefined,
          prioritizationFeeLamports: params.jitoTipLamports ? { jitoTipLamports: params.jitoTipLamports } : undefined,
          // The user's own wallet pays its own network fee — launch ships non-custodial,
          // see docs/WALLET_SECURITY.md's Solana section. This flag stays false until the
          // (not yet built) gasless relayer exists; flipping it on ahead of that relayer
          // would silently name a fee payer nothing here is prepared to co-sign as.
          wrapAndUnwrapSol: true,
        }),
      });
      if (!response.ok) {
        this.logger.warn({ status: response.status }, 'swap endpoint rejected the request');
        return null;
      }
      return (await response.json()) as JupiterSwapResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'swap endpoint unreachable');
      return null;
    }
  }
}

/** The slice of Jupiter's `/quote` response this service actually reads — deliberately
 *  not a full, strict type of Jupiter's entire schema; unrecognized extra fields are
 *  expected and harmless. */
interface JupiterQuoteResponse {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  /** A decimal string, e.g. "0.0012" for 0.12% — converted to bps in parsePriceImpactBps. */
  priceImpactPct?: string;
  platformFee?: { amount: string; feeBps: number } | null;
}

interface JupiterSwapResponse {
  swapTransaction: string;
}

function parsePriceImpactBps(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10_000);
}
