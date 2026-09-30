import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TokenTrenchesService } from './token-trenches.service';
import { TrenchesQueryDto } from './dto/trenches-query.dto';

const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** See `token-trenches.service.ts` — public, same authentication posture as
 *  `/discovery/rising` and friends. */
@Controller('tokens')
export class TokenTrenchesController {
  constructor(private readonly trenchesService: TokenTrenchesService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('trenches')
  trenches(@Query() query: TrenchesQueryDto) {
    return this.trenchesService.byCategory(query.category, query.limit);
  }

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('pumpfun/:mint')
  async pumpFunToken(@Param('mint') mint: string) {
    if (!SOLANA_MINT_PATTERN.test(mint)) throw new BadRequestException('mint must be a valid Solana mint address');
    const token = await this.trenchesService.byMint(mint);
    if (!token) throw new NotFoundException('Kamby has not seen this Pump.fun coin');
    return token;
  }
}
