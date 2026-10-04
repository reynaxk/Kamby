import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TOKEN_INFO_CHAINS, type TokenInfoChain } from '@kamby/domain';
import { LivePriceService } from './live-price.service';
import { TokenInfoService } from './token-info.service';
import { HoldersService } from './holders.service';

const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function parseCoin(chain: string, address: string): TokenInfoChain {
  if (!(TOKEN_INFO_CHAINS as readonly string[]).includes(chain)) {
    throw new BadRequestException(`chain must be one of ${TOKEN_INFO_CHAINS.join(', ')}`);
  }
  const pattern = chain === 'solana' ? SOLANA_MINT_PATTERN : EVM_ADDRESS_PATTERN;
  if (!pattern.test(address)) throw new BadRequestException('address is not a valid token address for that chain');
  return chain as TokenInfoChain;
}

@Controller('market')
export class TokenInfoController {
  constructor(
    private readonly tokenInfo: TokenInfoService,
    private readonly livePrices: LivePriceService,
    private readonly holdersService: HoldersService,
  ) {}

  /** A listed coin's website / socials / description — see TokenInfoService. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('token-info/:chain/:address')
  info(@Param('chain') chain: string, @Param('address') address: string) {
    return this.tokenInfo.info(parseCoin(chain, address), address);
  }

  /** A coin's largest holders — see HoldersService. Cached a minute and shared. */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('holders/:chain/:address')
  holders(@Param('chain') chain: string, @Param('address') address: string) {
    return this.holdersService.holders(parseCoin(chain, address), address);
  }

  /** The chart's "Live" price — polled every ~2s per viewer, see LivePriceService. */
  @Throttle({ default: { limit: 90, ttl: 60_000 } })
  @Get('live-price/:chain/:address')
  livePrice(@Param('chain') chain: string, @Param('address') address: string) {
    return this.livePrices.price(parseCoin(chain, address), address);
  }
}
