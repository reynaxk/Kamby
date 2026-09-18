import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { KyberSwapRouter } from './kyberswap-router.service';
import { OpenOceanRouter } from './openocean-router.service';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

/** Which provider prices which chain — a real per-chain split, not a race (see
 *  docs/MULTICHAIN_OCTOBER_PLAN.md's own note on why KyberSwap racing a second provider
 *  is a *same-chain* pattern, and this is a different shape: a single trade is always on
 *  exactly one chain, so there's never a "which quote is better" decision to make between
 *  these two — only "which chain is this." Update this map, not QuoteService or anything
 *  above SWAP_ROUTER, when a chain's provider ever changes.
 *
 *  BNB Chain moved from OpenOcean to KyberSwap 2026-09-17, the same day BNB trading went
 *  live: the first real trade attempt found `open-api.openocean.finance` returning a
 *  Cloudflare bot-challenge (HTTP 403 with a "Just a moment…" JS-challenge page) for
 *  *every* request — verified from multiple independent networks, not a Railway-specific
 *  block, and not something a plain server-side `fetch()` can pass no matter how the
 *  request is shaped. OpenOceanRouter itself is left in place (not deleted) in case a real,
 *  registered API key later grants access past that challenge — see its own doc comment. */
const CHAIN_ID_TO_PROVIDER: Record<number, 'kyberswap' | 'openocean'> = {
  8453: 'kyberswap', // Base
  42161: 'kyberswap', // Arbitrum
  56: 'kyberswap', // BNB Chain — see this map's own doc comment for why not OpenOcean
};

/**
 * Dispatches each quote request to the one provider that actually covers its chain —
 * KyberSwap for Base/Arbitrum, OpenOcean for BNB Chain (added 2026-09-15, see
 * OpenOceanRouter's own doc comment for why OpenOcean specifically). Bound directly to
 * `SWAP_ROUTER` in trading.module.ts; QuoteService and everything above it stays exactly
 * as unaware of "which provider, which chain" as it was when KyberSwap alone was Kamby's
 * sole EVM execution provider — see that class's own doc comment for the single-provider
 * era this replaces.
 *
 * Deliberately not a race: unlike the retired MetaAggregatorSwapRouter (which asked two
 * providers to price the *same* trade on the *same* chain and kept whichever quoted more),
 * a single trade is always on exactly one chain, so there is never a "which provider's
 * price is better" decision to make here — only "which provider even covers this chain."
 */
@Injectable()
export class MultiChainSwapRouter implements SwapRouter {
  constructor(
    private readonly kyberswap: KyberSwapRouter,
    private readonly openocean: OpenOceanRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('MultiChainSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const provider = CHAIN_ID_TO_PROVIDER[request.chainId];
    if (!provider) {
      this.logger.warn({ chainId: request.chainId }, 'quote failure: no execution provider mapped for this chainId');
      return null;
    }
    return provider === 'openocean' ? this.openocean.getQuote(request) : this.kyberswap.getQuote(request);
  }
}
