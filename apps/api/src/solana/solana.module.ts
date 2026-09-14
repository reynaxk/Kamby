import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { JupiterQuoteService } from './jupiter-quote.service';
import { SolanaController } from './solana.controller';
import { SolanaQuoteService } from './solana-quote.service';
import { SolanaTopupService } from './solana-topup.service';
import { SolanaTransactionService } from './solana-transaction.service';

/**
 * Solana trading — see docs/TRADING.md#solana. Additive alongside TradingModule (EVM),
 * not a replacement; no import either direction, same as every other feature module pair
 * in this codebase. Every service here returns/throws cleanly when SOLANA_ENABLED is
 * false rather than assuming it's on — see getSolanaConfig in ../config/env.ts.
 */
@Module({
  imports: [IdentityModule],
  controllers: [SolanaController],
  providers: [JupiterQuoteService, SolanaQuoteService, SolanaTransactionService, SolanaTopupService],
  // SolanaTransactionService's public getGlobalFeed — SocialModule's own controller hosts
  // the Solana activity routes alongside the EVM ones, same reasoning ActivityService is
  // already exported for DiscoveryModule's reuse (see social.module.ts's own comment): a
  // one-way dependency, SolanaModule has no need to import SocialModule back.
  exports: [SolanaTransactionService],
})
export class SolanaModule {}
