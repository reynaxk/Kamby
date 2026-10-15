import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SolanaModule } from '../solana/solana.module';
import { TradingModule } from '../trading/trading.module';
import { ClankerAdapter } from './adapters/clanker.adapter';
import { PumpFunAdapter } from './adapters/pumpfun.adapter';
import { LaunchpadController } from './launchpad.controller';
import { LaunchpadService } from './launchpad.service';

/** Kamby's LaunchPad (2026-10-14) — one adapter per launchpad; see LaunchpadService. */
@Module({
  imports: [IdentityModule, SolanaModule, TradingModule],
  controllers: [LaunchpadController],
  providers: [LaunchpadService, PumpFunAdapter, ClankerAdapter],
})
export class LaunchpadModule {}
