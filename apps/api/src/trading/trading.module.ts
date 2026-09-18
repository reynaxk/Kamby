import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { KyberSwapRouter } from './router/kyberswap-router.service';
import { MultiChainSwapRouter } from './router/multi-chain-swap-router.service';
import { OpenOceanRouter } from './router/openocean-router.service';
import { SWAP_ROUTER } from './router/swap-router.token';
import { EvmGasRelayerQuoteService } from './relayer/evm-gas-relayer-quote.service';
import { EvmGasRelayerService } from './relayer/evm-gas-relayer.service';
import { EvmRelayerNonceManagerService } from './relayer/evm-relayer-nonce-manager.service';
import { EvmRelayerWalletService } from './relayer/evm-relayer-wallet.service';
import { QuoteService } from './quote.service';
import { SafetyService } from './safety.service';
import { TradingController } from './trading.controller';
import { TransactionService } from './transaction.service';

/**
 * Owns swap quoting, transaction preparation/tracking, and trading fees — see
 * docs/TRADING.md. Never signs a transaction (see docs/WALLET_SECURITY.md); the router
 * adapter is the only place that knows which aggregator Kamby integrates with — see
 * docs/TRADING.md#provider. `MultiChainSwapRouter` is bound to `SWAP_ROUTER` as of
 * 2026-09-15 — it dispatches each request to whichever of `KyberSwapRouter` (Base/Arbitrum)
 * or `OpenOceanRouter` (BNB Chain, added the same day) actually covers that request's
 * chain; see that class's own doc comment for why this is a per-chain split, not a race.
 * `KyberSwapRouter` alone used to be bound directly here (2026-09-14, replacing the LI.FI/
 * 1inch meta-aggregator race — see git history) back when Base/Arbitrum were the only
 * chains Kamby traded on.
 */
@Module({
  imports: [IdentityModule],
  controllers: [TradingController],
  providers: [
    QuoteService,
    SafetyService,
    TransactionService,
    KyberSwapRouter,
    OpenOceanRouter,
    { provide: SWAP_ROUTER, useClass: MultiChainSwapRouter },
    EvmRelayerNonceManagerService,
    EvmRelayerWalletService,
    EvmGasRelayerService,
    EvmGasRelayerQuoteService,
  ],
})
export class TradingModule {}
