import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TokenTrenchesService } from './token-trenches.service';
import { TrenchesQueryDto } from './dto/trenches-query.dto';

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
}
