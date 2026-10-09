import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { KyberSwapRouter } from './kyberswap-router.service';
import { OpenOceanRouter } from './openocean-router.service';
import { VeloraRouter } from './velora-router.service';
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
  1: 'kyberswap', // Ethereum mainnet
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
/** How much more Velora must return to replace KyberSwap — and when its router needs a new approval. */
const BEST_OF_MARGIN_BPS = 30n;
const BEST_OF_NEW_APPROVAL_MARGIN_BPS = 100n;

@Injectable()
export class MultiChainSwapRouter implements SwapRouter {
  constructor(
    private readonly kyberswap: KyberSwapRouter,
    private readonly openocean: OpenOceanRouter,
    private readonly logger: PinoLogger,
    private readonly velora?: VeloraRouter,
  ) {
    this.logger.setContext('MultiChainSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const provider = CHAIN_ID_TO_PROVIDER[request.chainId];
    if (!provider) {
      this.logger.warn({ chainId: request.chainId }, 'quote failure: no execution provider mapped for this chainId');
      return null;
    }
    if (provider === 'openocean') return this.openocean.getQuote(request);
    // Best of two (2026-10-09): Velora is asked alongside KyberSwap for trades with no aggregator
    // fee. It wins only when it returns clearly more — 0.3%, or 1% if the user would need a new
    // approval for its router (an extra signature and gas) — and always when KyberSwap has nothing.
    const velora = this.velora && request.feeBps === 0 && this.velora.supports(request.chainId) ? this.velora : null;
    if (!velora) return this.kyberswap.getQuote(request);
    const [kyber, veloraPrice] = await Promise.all([this.kyberswap.getQuote(request), velora.price(request).catch(() => null)]);
    if (!veloraPrice) return kyber;
    if (!kyber) {
      this.logger.info({ chainId: request.chainId }, 'KyberSwap had no quote — using Velora');
      return velora.build(request, veloraPrice);
    }
    const kyberOut = BigInt(kyber.buyAmountRaw);
    const veloraOut = BigInt(veloraPrice.buyAmountRaw);
    if (veloraOut * 10_000n < kyberOut * (10_000n + BEST_OF_MARGIN_BPS)) return kyber;
    const needsApproval = await velora.needsApproval(request, veloraPrice.spender);
    if (needsApproval === null) return kyber;
    if (needsApproval && !kyber.requiresApproval && veloraOut * 10_000n < kyberOut * (10_000n + BEST_OF_NEW_APPROVAL_MARGIN_BPS)) return kyber;
    const built = await velora.build(request, veloraPrice);
    if (!built) return kyber;
    this.logger.info({ chainId: request.chainId, kyberOut: kyber.buyAmountRaw, veloraOut: built.buyAmountRaw }, 'Velora beat KyberSwap — using Velora');
    return built;
  }
}
