import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LiFiSwapRouter } from './router/li-fi-router.service';
import { OneInchSwapRouter } from './router/one-inch-router.service';
import { MetaAggregatorSwapRouter } from './router/meta-aggregator-router.service';
import { SWAP_ROUTER } from './router/swap-router.token';
import { QuoteService } from './quote.service';
import { SafetyService } from './safety.service';
import { TradingController } from './trading.controller';
import { TransactionService } from './transaction.service';

/**
 * Owns swap quoting, transaction preparation/tracking, and trading fees — see
 * docs/TRADING.md. Never signs a transaction (see docs/WALLET_SECURITY.md); the router
 * adapter is the only place that knows which aggregator(s) Kamby integrates with — see
 * docs/TRADING.md#provider. `LiFiSwapRouter`/`OneInchSwapRouter` are registered as plain
 * providers (not bound to `SWAP_ROUTER` themselves) purely so `MetaAggregatorSwapRouter`
 * can have both injected and race them — nothing else in this module reaches either
 * directly.
 */
@Module({
  imports: [IdentityModule],
  controllers: [TradingController],
  providers: [
    QuoteService,
    SafetyService,
    TransactionService,
    LiFiSwapRouter,
    OneInchSwapRouter,
    { provide: SWAP_ROUTER, useClass: MetaAggregatorSwapRouter },
  ],
})
export class TradingModule {}
