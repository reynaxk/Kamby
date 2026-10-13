import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { TradingModule } from '../trading/trading.module';
import { BridgeController } from './bridge.controller';
import { BridgeService } from './bridge.service';

@Module({
  imports: [IdentityModule, TradingModule],
  controllers: [BridgeController],
  providers: [BridgeService],
})
export class BridgeModule {}
