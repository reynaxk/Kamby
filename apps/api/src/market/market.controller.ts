import { Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DEFAULT_CHAIN_ID } from '@kamby/domain';
import { CurrentUser } from '../identity/current-user.decorator';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { OptionalAuthGuard } from '../identity/guards/optional-auth.guard';
import type { SessionUser } from '../identity/identity.service';
import { ChainIdQueryDto } from './dto/chain-id-query.dto';
import { DiscoverQueryDto } from './dto/discover-query.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { TokenTradersQueryDto } from './dto/token-traders-query.dto';
import { MarketService } from './market.service';
import { WatchlistService } from './watchlist.service';

/**
 * Read-only. Every response is normalized DB state (see market.mapper.ts) — never a raw
 * Prisma row, so there's one place controlling exactly what the web app can see. The
 * watch/unwatch/check routes are the one mutating exception (Phase 6) — see
 * docs/PHASE6_RETENTION_SOCIAL.md#watchlists.
 *
 * Chain-aware as of 2026-09-16 — see `ChainIdQueryDto`'s own doc comment. Every
 * single-token route now reads an optional `chainId` from the request (mirroring
 * `trading.controller.ts`'s identical `getQuote` substitution) instead of hardcoding
 * `DEFAULT_CHAIN_ID`; the services themselves were already chain-scoped and needed no
 * changes. `discover`/`search` deliberately still take no chainId — both are legitimately
 * cross-chain, each result row self-identifying via its own `chainIdentifier`.
 */
@Controller('market')
export class MarketController {
  constructor(
    private readonly marketService: MarketService,
    private readonly watchlist: WatchlistService,
  ) {}

  @Get('discover')
  discover(@Query() query: DiscoverQueryDto) {
    return this.marketService.discover(query);
  }

  @Get('chains')
  getChains() {
    return this.marketService.getChains();
  }

  // Search is cheap enough per-call but easy to hammer from a debounced input; keep it
  // tighter than the global default rather than relying on that alone.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get('search')
  search(@Query() query: SearchQueryDto) {
    return this.marketService.search(query);
  }

  @Get('tokens/:address')
  getToken(@Param('address') address: string, @Query() query: ChainIdQueryDto) {
    return this.marketService.getToken(address, query.chainId ?? DEFAULT_CHAIN_ID);
  }

  @Get('tokens/:address/history')
  getHistory(@Param('address') address: string, @Query() query: HistoryQueryDto) {
    return this.marketService.getHistory(address, query.chainId ?? DEFAULT_CHAIN_ID, query.timeframe);
  }

  /** Phase 5 — see docs/TRADER_INTELLIGENCE.md#token-to-trader. */
  @Get('tokens/:address/traders')
  getTokenTraders(@Param('address') address: string, @Query() query: TokenTradersQueryDto) {
    return this.marketService.getTokenTraders(address, query.chainId ?? DEFAULT_CHAIN_ID, query.limit);
  }

  /** `null` for an unauthenticated caller — same contract as `isFollowedByMe`, never a
   *  fabricated `false`. See docs/PHASE6_RETENTION_SOCIAL.md#watchlists. */
  @UseGuards(OptionalAuthGuard)
  @Get('tokens/:address/watch')
  async isWatching(@Param('address') address: string, @Query() query: ChainIdQueryDto, @CurrentUser() user: SessionUser | null) {
    return { watching: await this.watchlist.isWatching(user?.id ?? null, address, query.chainId ?? DEFAULT_CHAIN_ID) };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('tokens/:address/watch')
  async watch(@Param('address') address: string, @Query() query: ChainIdQueryDto, @CurrentUser() user: SessionUser) {
    await this.watchlist.watch(user.id, address, query.chainId ?? DEFAULT_CHAIN_ID);
    return { watching: true };
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Delete('tokens/:address/watch')
  async unwatch(@Param('address') address: string, @Query() query: ChainIdQueryDto, @CurrentUser() user: SessionUser) {
    await this.watchlist.unwatch(user.id, address, query.chainId ?? DEFAULT_CHAIN_ID);
    return { watching: false };
  }
}
