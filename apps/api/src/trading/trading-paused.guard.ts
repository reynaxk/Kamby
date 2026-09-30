import { CanActivate, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

export const TRADING_PAUSED_MESSAGE = 'Trading is paused for maintenance — please try again shortly. Your funds are safe in your wallet.';

/**
 * The launch-day emergency switch: with TRADING_PAUSED=true on the api service, every *new*
 * quote (EVM, Solana, sponsored Solana) is refused with a 503, so no new trade can start.
 * Deliberately NOT applied to recording or finishing a trade the user already signed
 * (POST .../transactions, the fee step) — cutting those off mid-trade would leave a real
 * on-chain trade untracked. Browsing is unaffected. See docs/LAUNCH_RUNBOOK.md.
 */
@Injectable()
export class TradingPausedGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(): boolean {
    if (this.config.get('TRADING_PAUSED', { infer: true })) throw new ServiceUnavailableException(TRADING_PAUSED_MESSAGE);
    return true;
  }
}
