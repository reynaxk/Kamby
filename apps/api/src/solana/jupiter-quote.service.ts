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
/** Confirmed live 2026-09-17 with a real quote + a real POST (not assumed from docs) — see
 *  `getSwapInstructions`'s own doc comment for exactly what was verified. */
const JUPITER_SWAP_INSTRUCTIONS_URL = 'https://api.jup.ag/swap/v1/swap-instructions';

/** Jupiter's free tier is 1 req/sec — a 429 is an expected, normal response under any real
 *  concurrent traffic (or even a single SELL quote's own extra fee-discovery call, see
 *  SolanaQuoteService#resolvePlatformFeeBps), not a real failure. Retried with backoff
 *  rather than surfaced as an immediate quote failure — see fetchWithRetry below. Capped
 *  low enough that a still-rate-limited request still fails within a few seconds rather
 *  than leaving a user staring at a spinner indefinitely. */
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 400;

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
 * `KyberSwapRouter` carries for KyberSwap.
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
   * The gas relayer's transaction-construction half — see docs/GAS_RELAYER_PLAN.md and
   * `GasRelayerService`'s own doc comment for the co-signing half this feeds. Returns raw,
   * unassembled instructions (never a fully-built transaction) with `params.payer` — the
   * relayer's own pubkey, never the user's — funding every setup/ATA-creation instruction;
   * `gas-relayer-transaction-builder.ts` assembles the actual `VersionedTransaction` from
   * this.
   *
   * Confirmed live 2026-09-17 against a real quote and a real POST to this endpoint —
   * `docs/GAS_RELAYER_PLAN.md` originally flagged this shape as doc-derived and unverified;
   * this is the real verification, not a repeat of that caveat. Response shape confirmed:
   * `computeBudgetInstructions[]`, `setupInstructions[]`, `swapInstruction` (singular),
   * `cleanupInstruction` (singular, nullable), `addressLookupTableAddresses[]` — each
   * instruction as `{programId, accounts: [{pubkey, isSigner, isWritable}], data (base64)}`.
   * `payer` genuinely does redirect the setup instructions' funding source: a real
   * `setupInstructions[0]` (an ATA `CreateIdempotent`) had the passed-in `payer` value as
   * its own account index 0, exactly as `GAS_RELAYER_PLAN.md` hoped. The `cleanupInstruction`
   * for a SOL-output swap is a real `CloseAccount` on the exact same account
   * `setupInstructions` created, refunding the *user's* own wallet (never the payer) — this
   * is the real shape `gas-relayer-instruction-guard.ts`'s WSOL-unwrap exception was built
   * to recognize, confirmed against a live response rather than assumed.
   */
  async getSwapInstructions(params: JupiterSwapInstructionsParams): Promise<JupiterSwapInstructionsResult | null> {
    if (this.apiKey === null) {
      this.logger.error('no Jupiter API key configured — cannot request swap instructions');
      return null;
    }

    const quote = await this.fetchQuote(params);
    if (!quote) return null;

    try {
      const response = await this.fetchWithRetry(JUPITER_SWAP_INSTRUCTIONS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: params.userPublicKey,
          payer: params.payer,
          feeAccount: params.platformFeeBps > 0 ? params.feeAccount : undefined,
          wrapAndUnwrapSol: true,
        }),
      });
      if (!response.ok) {
        if (response.status === 429) {
          this.logger.error({ status: response.status }, 'swap-instructions endpoint still rate-limited after retries');
        } else {
          this.logger.warn({ status: response.status }, 'swap-instructions endpoint rejected the request');
        }
        return null;
      }
      const body = (await response.json()) as JupiterSwapInstructionsResponse;
      return {
        inputAmountRaw: quote.inAmount,
        outputAmountRaw: quote.outAmount,
        minOutputAmountRaw: quote.otherAmountThreshold,
        priceImpactBps: parsePriceImpactBps(quote.priceImpactPct),
        platformFeeAmountRaw: quote.platformFee?.amount ?? null,
        computeBudgetInstructions: body.computeBudgetInstructions,
        setupInstructions: body.setupInstructions,
        swapInstruction: body.swapInstruction,
        cleanupInstruction: body.cleanupInstruction ?? null,
        addressLookupTableAddresses: body.addressLookupTableAddresses,
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'swap-instructions endpoint unreachable');
      return null;
    }
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
      const response = await this.fetchWithRetry(url, { headers: { 'x-api-key': this.apiKey! } });
      if (!response.ok) {
        // Never leak the raw provider body (may echo request params back) — log status only.
        if (response.status === 429) {
          this.logger.error({ status: response.status }, 'quote endpoint still rate-limited after retries');
        } else {
          this.logger.warn({ status: response.status }, 'quote endpoint rejected the request');
        }
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
      const response = await this.fetchWithRetry(JUPITER_SWAP_URL, {
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
        if (response.status === 429) {
          this.logger.error({ status: response.status }, 'swap endpoint still rate-limited after retries');
        } else {
          this.logger.warn({ status: response.status }, 'swap endpoint rejected the request');
        }
        return null;
      }
      return (await response.json()) as JupiterSwapResponse;
    } catch (error) {
      this.logger.warn({ err: error }, 'swap endpoint unreachable');
      return null;
    }
  }

  /**
   * Wraps `fetch`, retrying only on 429 (Jupiter's own rate-limit status) — any other
   * status (a malformed request, a genuine 5xx) is returned as-is on the first attempt,
   * since retrying those would just repeat the same failure. Honors Jupiter's own
   * `Retry-After` header when present; otherwise backs off exponentially with jitter so
   * concurrent requests don't all retry in lockstep and re-collide on the next attempt.
   */
  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let response = await fetch(url, init);
    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS && response.status === 429; attempt++) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader !== null ? Number(retryAfterHeader) : NaN;
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : BASE_RETRY_DELAY_MS * 2 ** attempt + Math.random() * 250;

      this.logger.warn({ attempt: attempt + 1, delayMs: Math.round(delayMs) }, 'Jupiter rate limit (429) — retrying after backoff');
      await sleep(delayMs);
      response = await fetch(url, init);
    }
    return response;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export interface JupiterSwapInstructionsParams {
  inputMint: string;
  outputMint: string;
  amountRaw: string;
  slippageBps: number;
  userPublicKey: string;
  platformFeeBps: number;
  feeAccount: string;
  /** The gas relayer's own pubkey — funds every setup/ATA-creation instruction Jupiter's
   *  response includes. Never the user's own wallet; see `getSwapInstructions`'s own doc
   *  comment for what this was confirmed to do against a real live call. */
  payer: string;
}

/** One raw, unassembled instruction from Jupiter's `/swap-instructions` response —
 *  deliberately not run through this codebase's own `ResolvedInstruction` shape
 *  (`gas-relayer-instruction-guard.ts`) here: that shape needs base58 pubkeys and
 *  ALT-resolved accounts, which only exist once `gas-relayer-transaction-builder.ts` has
 *  actually assembled a real `VersionedTransaction` and `GasRelayerService` has resolved
 *  it — converting twice would be redundant, not extra safety. */
export interface JupiterRawInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  /** Base64-encoded instruction data. */
  data: string;
}

export interface JupiterSwapInstructionsResult {
  /** Same quote-derived fields `getQuote`'s own `JupiterQuoteResult` returns — read off the
   *  same underlying `/quote` response this method already fetches internally, so callers
   *  never need a second round trip just to persist a quote row. */
  inputAmountRaw: string;
  outputAmountRaw: string;
  minOutputAmountRaw: string;
  priceImpactBps: number | null;
  platformFeeAmountRaw: string | null;
  computeBudgetInstructions: JupiterRawInstruction[];
  setupInstructions: JupiterRawInstruction[];
  swapInstruction: JupiterRawInstruction;
  /** `null` when this swap doesn't need any cleanup (e.g. no wrapped-SOL account to
   *  unwrap) — most swaps that don't touch native SOL never have one. */
  cleanupInstruction: JupiterRawInstruction | null;
  addressLookupTableAddresses: string[];
}

/** The slice of Jupiter's real `/swap-instructions` response this service reads —
 *  deliberately not a full, strict type of the whole response (it also carries
 *  `tokenLedgerInstruction`, `otherInstructions`, `prioritizationFeeLamports`,
 *  `computeUnitLimit`, and several other fields this codebase has no use for yet). */
interface JupiterSwapInstructionsResponse {
  computeBudgetInstructions: JupiterRawInstruction[];
  setupInstructions: JupiterRawInstruction[];
  swapInstruction: JupiterRawInstruction;
  cleanupInstruction?: JupiterRawInstruction | null;
  addressLookupTableAddresses: string[];
}

function parsePriceImpactBps(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const pct = Number(raw);
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct * 10_000);
}
