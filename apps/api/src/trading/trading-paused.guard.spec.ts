import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { TRADING_PAUSED_MESSAGE, TradingPausedGuard } from './trading-paused.guard';

function guard(paused: boolean) {
  return new TradingPausedGuard({ get: () => paused } as unknown as ConfigService<Env, true>);
}

describe('TradingPausedGuard', () => {
  it('lets quotes through normally', () => {
    expect(guard(false).canActivate()).toBe(true);
  });

  it('refuses new quotes with a clear 503 while trading is paused', () => {
    expect(() => guard(true).canActivate()).toThrow(new ServiceUnavailableException(TRADING_PAUSED_MESSAGE));
  });
});

describe('TradingPausedGuard wiring', () => {
  // Imported lazily so this file's unit tests above don't pull in every controller dependency.
  const guardsOn = (target: object, method: string): unknown[] =>
    (Reflect.getMetadata('__guards__', (target as Record<string, unknown>)[method] as object) as unknown[] | undefined) ?? [];

  it('guards every route that starts a trade (EVM quote, Solana quote, sponsored Solana quote)', async () => {
    const { TradingController } = await import('./trading.controller');
    const { SolanaController } = await import('../solana/solana.controller');
    expect(guardsOn(TradingController.prototype, 'getQuote')).toContain(TradingPausedGuard);
    expect(guardsOn(SolanaController.prototype, 'getQuote')).toContain(TradingPausedGuard);
    expect(guardsOn(SolanaController.prototype, 'getSponsoredQuote')).toContain(TradingPausedGuard);
  });

  it('never guards recording a trade the user already signed', async () => {
    const { TradingController } = await import('./trading.controller');
    const { SolanaController } = await import('../solana/solana.controller');
    expect(guardsOn(TradingController.prototype, 'submitTransaction')).not.toContain(TradingPausedGuard);
    expect(guardsOn(SolanaController.prototype, 'submitTransaction')).not.toContain(TradingPausedGuard);
  });
});
