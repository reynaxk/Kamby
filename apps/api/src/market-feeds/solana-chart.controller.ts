import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SolanaChartService } from './solana-chart.service';

const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

@Controller('market/solana')
export class SolanaChartController {
  constructor(private readonly charts: SolanaChartService) {}

  /** Candles for a Solana coin Kamby lists — see SolanaChartService. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':mint/history')
  history(@Param('mint') mint: string, @Query('timeframe') timeframe = '1H') {
    if (!SOLANA_MINT_PATTERN.test(mint)) throw new BadRequestException('mint must be a valid Solana mint address');
    return this.charts.history(mint, timeframe);
  }
}
