import { Controller, Get, Sse, type MessageEvent } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Observable } from 'rxjs';
import { MarketFeedsService } from './market-feeds.service';

/**
 * Public, unauthenticated — the same market data Discover already serves. See
 * MarketFeedsService for how the stream stays cheap regardless of viewer count.
 */
@Controller('market/feeds')
export class MarketFeedsController {
  constructor(private readonly feeds: MarketFeedsService) {}

  /** All five tabs at once, for the server-rendered first paint. */
  @Get()
  snapshot() {
    return this.feeds.snapshot();
  }

  /** Event names: trending, graduated, trenches, bonding, crypto (full snapshots), pumpfun
   *  (incremental — merge by mintAddress), heartbeat. One long-lived request per viewer;
   *  the throttle only bounds (re)connect attempts, same as the notification stream. */
  @Sse('stream')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  stream(): Observable<MessageEvent> {
    return this.feeds.stream();
  }
}
