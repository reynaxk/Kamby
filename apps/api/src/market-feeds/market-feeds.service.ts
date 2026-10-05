import { Injectable, Optional, type MessageEvent } from '@nestjs/common';
import {
  isCuratedMarket,
  NEW_MARKET_WINDOW_HOURS,
  type FeedMarket,
  type MarketFeedEvents,
  type MarketFeedSnapshot,
  type MarketSummary,
  type PumpFunTokenSummary,
} from '@kamby/domain';
import { PinoLogger } from 'nestjs-pino';
import { catchError, distinctUntilChanged, EMPTY, filter, from, interval, map, merge, type Observable, shareReplay, switchMap, timer } from 'rxjs';
import type { DiscoverQueryDto } from '../market/dto/discover-query.dto';
import { MarketService } from '../market/market.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TokenTrenchesService } from '../tokens/token-trenches.service';
import { TrenchesCategory } from '../tokens/trenches-category.enum';
import { CryptoPriceService } from './crypto-price.service';
import { PumpFunIconService } from './pumpfun-icon.service';
import { XxxRiskService } from './xxxrisk.service';
import { FeedPricesService } from './feed-prices.service';

/** How often each tab's snapshot is rebuilt — the same 10s the underlying Redis caches use. */
export const FEED_REFRESH_MS = 10_000;
const HEARTBEAT_MS = 25_000;
const TRENDING_LIMIT = 100;
/** Trending is for coins people chase, not majors (user feedback 2026-10-03: "why are you
 *  working on the big coins again"). Stablecoins, wrapped/bridged majors and anything with a
 *  market cap of $500M+ are left out — still tradable and searchable, and BTC/ETH/SOL/BNB/AVAX
 *  have the Crypto tab. */
const TRENDING_MAX_MARKET_CAP_USD = 500_000_000;
const TRENDING_MIN_ROWS = 15;
const NOT_TRENDING_SYMBOLS = new Set([
  'USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USD1', 'BUSD', 'PYUSD',
  'WETH', 'ETH', 'WBNB', 'BNB', 'BTCB', 'CBBTC', 'WBTC', 'BTC', 'SOL', 'WSOL', 'CBETH', 'WSTETH', 'STETH',
]);

/** Exported for tests. Majors out, the rest in score order; topped up from the majors only if
 *  too few remain, so the tab is never empty. */
export function trendingMarkets<T extends { symbol: string | null; marketCapUsd: number | null; chainIdentifier: string }>(ranked: readonly T[]): T[] {
  const isMajor = (m: T) =>
    NOT_TRENDING_SYMBOLS.has((m.symbol ?? '').toUpperCase()) || (m.marketCapUsd ?? 0) >= TRENDING_MAX_MARKET_CAP_USD;
  const picks = mixChains(ranked.filter((m) => !isMajor(m))).slice(0, TRENDING_LIMIT);
  return picks.length >= TRENDING_MIN_ROWS ? picks : [...picks, ...ranked.filter(isMajor)].slice(0, Math.max(TRENDING_MIN_ROWS, picks.length));
}

/** Exported for tests. Round-robin across chains, each chain keeping its own score order — so
 *  hundreds of Solana launchpad coins can't push every Base and BNB coin off Trending
 *  (seen 2026-10-03: 93 Solana vs 3 EVM after Jupiter discovery went live). */
export function mixChains<T extends { chainIdentifier: string }>(ranked: readonly T[]): T[] {
  const byChain = new Map<string, T[]>();
  for (const m of ranked) byChain.set(m.chainIdentifier, [...(byChain.get(m.chainIdentifier) ?? []), m]);
  const queues = [...byChain.values()];
  const out: T[] = [];
  for (let i = 0; out.length < ranked.length; i++) for (const q of queues) if (q[i]) out.push(q[i]!);
  return out;
}
const GRADUATED_LIMIT = 30;
const TRENCHES_LIMIT = 50;

type Snapshots = MarketFeedSnapshot;
type TabData<K extends keyof Snapshots> = Omit<Snapshots[K], 'atIso'>;

/** Every Solana market is from the curated list; an EVM market is vetted if it's on the seed list. */
export function toFeedMarket(market: MarketSummary, listedAtIso?: string): FeedMarket {
  const vetted = market.chainIdentifier === 'solana' || isCuratedMarket(market.chainIdentifier, market.tokenAddress);
  return { ...market, listing: vetted ? 'vetted' : 'new', ...(listedAtIso ? { listedAtIso } : {}) };
}

/**
 * The terminal's five discovery tabs as one Server-Sent Events stream — see
 * docs/MARKET_DATA.md#market-feeds. Built so the number of connected viewers never
 * multiplies upstream work:
 *
 * - Each tab is one shared stream (`shareReplay` with refCount): rebuilt every
 *   FEED_REFRESH_MS from the existing 10s Redis-cached reads (Discover, recently listed,
 *   trenches), however many browsers are listening, and not at all when none are.
 * - A tab is only sent when its content actually changed (compared without the timestamp).
 * - A new viewer gets every tab's latest snapshot immediately (the replayed value).
 * - Crypto prices come from one Coinbase socket per process; Pump.fun changes are pushed
 *   from the workers over Redis the moment they're flushed.
 *
 * A failed rebuild is skipped (the last good snapshot stands), never sent as an empty tab.
 */
@Injectable()
export class MarketFeedsService {
  private readonly trending$ = this.sharedTab('trending', async () => ({
    markets: (await this.livePrices(trendingMarkets(await this.market.discover(discoverQuery())))).map((m) => toFeedMarket(m)),
  }));
  private readonly graduated$ = this.sharedTab('graduated', async () => this.buildGraduated());
  private readonly trenches$ = this.sharedTab('trenches', async () => ({ tokens: await this.trenchesTokens(TrenchesCategory.FRESH) }));
  private readonly bonding$ = this.sharedTab('bonding', async () => ({ tokens: await this.trenchesTokens(TrenchesCategory.NEAR_GRADUATED) }));
  private readonly xxxrisk$ = this.sharedTab('xxxrisk', async () => ({ tokens: await this.xxxrisk.build() }));

  constructor(
    private readonly market: MarketService,
    private readonly trenches: TokenTrenchesService,
    private readonly cryptoPrices: CryptoPriceService,
    private readonly realtime: RealtimeService,
    private readonly logger: PinoLogger,
    private readonly icons: PumpFunIconService,
    private readonly xxxrisk: XxxRiskService,
    @Optional() private readonly feedPrices?: FeedPricesService,
  ) {
    this.logger.setContext('MarketFeedsService');
  }

  /** Every tab at once — the server-rendered first paint, before the stream connects. */
  async snapshot(): Promise<Snapshots> {
    const atIso = new Date().toISOString();
    const [trending, graduated, trenches, bonding, xxxrisk] = await Promise.all([
      this.market.discover(discoverQuery()),
      this.buildGraduated(),
      this.trenchesTokens(TrenchesCategory.FRESH),
      this.trenchesTokens(TrenchesCategory.NEAR_GRADUATED),
      this.xxxrisk.cached(),
    ]);
    return {
      trending: { markets: (await this.livePrices(trendingMarkets(trending))).map((m) => toFeedMarket(m)), atIso },
      graduated: { ...graduated, atIso },
      trenches: { tokens: trenches, atIso },
      bonding: { tokens: bonding, atIso },
      xxxrisk: { tokens: xxxrisk, atIso },
      crypto: { prices: this.cryptoPrices.snapshot(), atIso },
    };
  }

  stream(): Observable<MessageEvent> {
    const event = <K extends keyof MarketFeedEvents>(type: K, data: MarketFeedEvents[K]): MessageEvent => ({ type, data });
    return merge(
      this.trending$.pipe(map((d) => event('trending', d))),
      this.graduated$.pipe(map((d) => event('graduated', d))),
      this.trenches$.pipe(map((d) => event('trenches', d))),
      this.bonding$.pipe(map((d) => event('bonding', d))),
      this.xxxrisk$.pipe(map((d) => event('xxxrisk', d))),
      this.cryptoPrices.prices$.pipe(
        filter((prices) => prices.length > 0),
        map((prices) => event('crypto', { prices, atIso: new Date().toISOString() })),
      ),
      this.realtime.pumpFunEvents$.pipe(map((batch) => event('pumpfun', batch))),
      interval(HEARTBEAT_MS).pipe(map(() => event('heartbeat', { atIso: new Date().toISOString() }))),
    );
  }

  private async buildGraduated(): Promise<TabData<'graduated'>> {
    const [listed, pumpfun] = await Promise.all([
      this.market.recentlyListed(NEW_MARKET_WINDOW_HOURS, GRADUATED_LIMIT),
      this.trenchesTokens(TrenchesCategory.JUST_GRADUATED, GRADUATED_LIMIT),
    ]);
    const priced = await this.livePrices(listed);
    return { markets: priced.map(({ listedAtIso, ...m }) => toFeedMarket(m, listedAtIso)), pumpfun };
  }

  /** Fresh DexScreener prices on every list row — see FeedPricesService. */
  private async livePrices<T extends MarketSummary>(markets: T[]): Promise<T[]> {
    return this.feedPrices ? this.feedPrices.apply(markets) : markets;
  }

  private async trenchesTokens(category: TrenchesCategory, limit = TRENCHES_LIMIT): Promise<PumpFunTokenSummary[]> {
    return this.icons.attach((await this.trenches.byCategory(category, limit)) as PumpFunTokenSummary[]);
  }

  private sharedTab<K extends keyof Snapshots>(tab: K, build: () => Promise<TabData<K>>): Observable<Snapshots[K]> {
    return timer(0, FEED_REFRESH_MS).pipe(
      switchMap(() =>
        from(build()).pipe(
          catchError((error: unknown) => {
            this.logger.warn({ err: error, tab }, 'Market feed rebuild failed — keeping the last snapshot');
            return EMPTY;
          }),
        ),
      ),
      map((data) => ({ data, json: JSON.stringify(data) })),
      distinctUntilChanged((a, b) => a.json === b.json),
      map(({ data }) => ({ ...data, atIso: new Date().toISOString() }) as Snapshots[K]),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }
}

function discoverQuery(): DiscoverQueryDto {
  // Deeper than the tab itself, so every chain has enough candidates to mix (see mixChains).
  return { sort: 'score', limit: TRENDING_LIMIT * 4 } as DiscoverQueryDto;
}
