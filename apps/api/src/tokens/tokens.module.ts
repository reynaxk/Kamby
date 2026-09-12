import { Module } from '@nestjs/common';
import { TokenTrenchesController } from './token-trenches.controller';
import { TokenTrenchesService } from './token-trenches.service';

/** Currently just the Trenches lifecycle filter — see `token-trenches.service.ts`. A
 *  separate module from MarketModule since it's a distinct read pattern (category-based
 *  filtering, not chain/address lookups) with its own eventual data needs (bonding-curve
 *  state) that MarketModule's Uniswap-V3-market-only scope doesn't own. */
@Module({
  controllers: [TokenTrenchesController],
  providers: [TokenTrenchesService],
})
export class TokensModule {}
