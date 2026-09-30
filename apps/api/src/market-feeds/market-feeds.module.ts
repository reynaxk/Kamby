import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TokensModule } from '../tokens/tokens.module';
import { CryptoPriceService } from './crypto-price.service';
import { MarketFeedsController } from './market-feeds.controller';
import { MarketFeedsService } from './market-feeds.service';
import { SolanaChartController } from './solana-chart.controller';
import { SolanaChartService } from './solana-chart.service';
import { TokenInfoController } from './token-info.controller';
import { TokenInfoService } from './token-info.service';
import { LivePriceService } from './live-price.service';

@Module({
  imports: [MarketModule, TokensModule, RealtimeModule],
  controllers: [MarketFeedsController, SolanaChartController, TokenInfoController],
  providers: [CryptoPriceService, MarketFeedsService, SolanaChartService, TokenInfoService, LivePriceService],
})
export class MarketFeedsModule {}
