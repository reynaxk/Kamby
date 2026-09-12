import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { LiFiSwapRouter } from './li-fi-router.service';
import { OneInchSwapRouter } from './one-inch-router.service';
import type { SwapRouter, SwapRouterQuote, SwapRouterQuoteRequest } from './swap-router.interface';

/**
 * Deliberately not the spec'd 150ms: that's shorter than a single cross-continent HTTPS
 * round trip to either provider, let alone two in parallel plus JSON parsing — a bound that
 * tight would make every quote fail. This is a real, honest ceiling for "how long a user
 * will wait for a quote," not a marketing SLA number. Tune down once this has run against
 * real traffic and real provider latency.
 */
const RACE_TIMEOUT_MS = 4000;

/**
 * Races LI.FI and 1inch in parallel for every quote and takes whichever prices *more*
 * output for the trader — never a fixed "primary" provider — falling back to the other if
 * one times out, errors, or has no route. See docs/TRADING.md#provider. This class owns
 * only the race/comparison; all provider-specific request/response shape stays inside
 * `LiFiSwapRouter`/`OneInchSwapRouter` — this file never talks to either API directly.
 *
 * Deliberately two providers, not three: 0x's free tier doesn't exist at meaningful volume
 * (its paid tier runs $1,000+/mo — see docs/TRADING.md#provider) and racing a provider
 * Kamby would need to pay for defeats the point of a cost-conscious meta-aggregator.
 */
@Injectable()
export class MetaAggregatorSwapRouter implements SwapRouter {
  constructor(
    private readonly lifi: LiFiSwapRouter,
    private readonly oneInch: OneInchSwapRouter,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('MetaAggregatorSwapRouter');
  }

  async getQuote(request: SwapRouterQuoteRequest): Promise<SwapRouterQuote | null> {
    const startedAt = Date.now();
    const [lifiResult, oneInchResult] = await Promise.allSettled([
      withTimeout(this.lifi.getQuote(request), RACE_TIMEOUT_MS),
      withTimeout(this.oneInch.getQuote(request), RACE_TIMEOUT_MS),
    ]);

    const candidates: SwapRouterQuote[] = [];
    if (lifiResult.status === 'fulfilled' && lifiResult.value) candidates.push(lifiResult.value);
    else this.logAttemptFailure('li.fi', lifiResult);

    if (oneInchResult.status === 'fulfilled' && oneInchResult.value) candidates.push(oneInchResult.value);
    else this.logAttemptFailure('1inch', oneInchResult);

    if (candidates.length === 0) {
      this.logger.warn({ latencyMs: Date.now() - startedAt }, 'quote failure: no provider returned a usable quote');
      return null;
    }

    // Higher raw output wins — both candidates quote the same sellAmountRaw (the request),
    // so comparing buyAmountRaw directly is a fair apples-to-apples comparison, never a
    // computed/estimated ranking.
    const winner = candidates.reduce((best, candidate) =>
      BigInt(candidate.buyAmountRaw) > BigInt(best.buyAmountRaw) ? candidate : best,
    );

    this.logger.info(
      {
        latencyMs: Date.now() - startedAt,
        winner: winner.provider,
        candidateCount: candidates.length,
      },
      'quote created',
    );
    return winner;
  }

  private logAttemptFailure(provider: string, result: PromiseSettledResult<SwapRouterQuote | null>): void {
    if (result.status === 'rejected') {
      this.logger.warn({ provider, err: result.reason }, 'provider attempt failed (timeout or unexpected error)');
    }
    // A fulfilled `null` (no route, provider-reported failure) is already logged by that
    // provider's own router — nothing more to say here.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
