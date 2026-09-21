'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CHAIN_REGISTRY,
  DEFAULT_CHAIN_SLUG,
  slugForIdentifier,
  type Candle,
  type MarketSummary,
  type SocialActivity,
  type Timeframe,
  type TokenTraderConnection,
  type TrendingToken,
} from '@kamby/domain';
import { cn, Surface } from '@kamby/ui';
import { LayoutGrid } from 'lucide-react';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { DataHub } from '@/components/terminal/DataHub';
import { KambyChart } from '@/components/terminal/KambyChart';
import { TokenMetricsBar } from '@/components/terminal/TokenMetricsBar';
import { IN_FLIGHT_STEPS, TradePanelCard } from '@/components/terminal/TradePanelCard';
import { type TradePanelStep } from '@/components/trading/TradePanel';
import { useIsMobile } from '@/hooks/useIsMobile';
import { fetchTokenTraders } from '@/lib/discovery-client';
import { fetchTokenHistory } from '@/lib/market-client';
import { fetchLatestActivity } from '@/lib/social-client';
import { DiscoverTokenList } from './DiscoverTokenList';
import { GridTerminalCell } from './GridTerminalCell';
import { InlineTimeframeTabs } from './InlineTimeframeTabs';
import { MyPositionsPanel } from './MyPositionsPanel';
import { useChartOverlayFilter } from './useChartOverlayFilter';
import { TokenTradersPanel } from './TokenTradersPanel';

type FetchStatus = 'loading' | 'ready' | 'error';
type GridMode = 1 | 4 | 6;
const GRID_MODES: GridMode[] = [1, 4, 6];

function chainIdFor(market: MarketSummary): number {
  const slug = slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG;
  return CHAIN_REGISTRY[slug].numericId;
}

function marketKey(market: MarketSummary): string {
  return `${market.chainIdentifier}:${market.tokenAddress}`;
}

/** The pool every grid cell's own independent selector picks from — Markets/Trending/
 *  Movers/Volume, deduplicated by chain+address. Zero new fetches: these are the same
 *  lists the single-terminal's left rail already renders from. */
function dedupeMarkets(lists: MarketSummary[][]): MarketSummary[] {
  const seen = new Set<string>();
  const result: MarketSummary[] = [];
  for (const list of lists) {
    for (const market of list) {
      const key = marketKey(market);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(market);
    }
  }
  return result;
}

/**
 * Discover's hero: the same 3-column terminal shape KambyTerminal.tsx built for the token
 * detail page, but in-place and client-driven here — clicking a token in the left rail
 * repopulates the chart/data-feed/trade-panel columns without a page navigation, matching
 * how GMGN/Photon/BullX-style terminals behave. See the visual-overhaul plan for the full
 * design trail (race-condition handling, the TradePanel stale-state fix, the cross-chain
 * traders bug this also fixes).
 *
 * The default selection's candles/activity/traders are server-seeded via `initial*` props
 * (app/page.tsx fetches them alongside its existing parallel fetches) — no fetch, no loading
 * flash, on first paint. Every *subsequent* selection or timeframe change fetches fresh via
 * the client-safe lib/market-client.ts / lib/social-client.ts / lib/discovery-client.ts
 * functions, each independently cancelled/guarded against out-of-order responses (the same
 * pattern TrenchesPanel.tsx already uses for its own category switches).
 *
 * Multi-Chart Grid (1/4/6-up): a real multi-monitor trading matrix, not a shared view —
 * flipping to 4-up or 6-up swaps this single terminal out for N independent
 * GridTerminalCell instances, each owning its own token selection, candles fetch, and full
 * trade flow. Deliberately scoped down from the single-terminal view: no left rail (each
 * cell has its own compact selector instead — see CellTokenSelector), no activity feed, no
 * token-traders panel — there isn't room for six of each at once, and those stay a
 * 1-up-only feature (switch back for deep research on one token). 1-up mode is exactly
 * today's unmodified single-terminal layout.
 */
export function DiscoverTerminal({
  ranked,
  trending,
  movers,
  byVolume,
  initialMarket,
  initialTimeframe,
  initialCandles,
  initialActivity,
  initialTraders,
}: {
  ranked: MarketSummary[];
  trending: TrendingToken[];
  movers: MarketSummary[];
  byVolume: MarketSummary[];
  initialMarket: MarketSummary | null;
  initialTimeframe: Timeframe;
  initialCandles: Candle[];
  initialActivity: SocialActivity[];
  initialTraders: TokenTraderConnection;
}) {
  const isMobile = useIsMobile();
  const [gridMode, setGridMode] = useState<GridMode>(1);
  const [tokenListOpen, setTokenListOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const availableMarkets = dedupeMarkets([ranked, trending.map((t) => t.market), movers, byVolume]);

  const [selected, setSelected] = useState<MarketSummary | null>(initialMarket);
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [tradeStep, setTradeStep] = useState<TradePanelStep>('form');
  const inFlight = IN_FLIGHT_STEPS.has(tradeStep);

  const [candles, setCandles] = useState<Candle[]>(initialCandles);
  const [candlesStatus, setCandlesStatus] = useState<FetchStatus>('ready');
  const skipCandlesFetch = useRef(true);

  const [activity, setActivity] = useState<SocialActivity[]>(initialActivity);
  const [activityStatus, setActivityStatus] = useState<FetchStatus>('ready');
  const skipActivityFetch = useRef(true);

  const [traders, setTraders] = useState<TokenTraderConnection>(initialTraders);
  const [tradersStatus, setTradersStatus] = useState<FetchStatus>('ready');
  const skipTradersFetch = useRef(true);

  useEffect(() => {
    if (skipCandlesFetch.current) {
      skipCandlesFetch.current = false;
      return;
    }
    if (!selected) return;
    let cancelled = false;
    setCandlesStatus('loading');
    fetchTokenHistory(selected.tokenAddress, timeframe, chainIdFor(selected))
      .then((result) => {
        if (cancelled) return;
        setCandles(result);
        setCandlesStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setCandlesStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selected, timeframe]);

  useEffect(() => {
    if (skipActivityFetch.current) {
      skipActivityFetch.current = false;
      return;
    }
    if (!selected) return;
    let cancelled = false;
    setActivityStatus('loading');
    fetchLatestActivity({ tokenAddress: selected.tokenAddress, limit: 10 })
      .then((result) => {
        if (cancelled) return;
        setActivity(result.items);
        setActivityStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setActivityStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (skipTradersFetch.current) {
      skipTradersFetch.current = false;
      return;
    }
    if (!selected) return;
    let cancelled = false;
    setTradersStatus('loading');
    fetchTokenTraders(selected.tokenAddress, chainIdFor(selected), 8)
      .then((result) => {
        if (cancelled) return;
        setTraders(result);
        setTradersStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setTradersStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  function handleSelect(market: MarketSummary) {
    if (inFlight) return;
    setSelected(market);
  }

  const selectedKey = selected ? marketKey(selected) : null;
  const chainId = selected ? chainIdFor(selected) : null;
  const canTrade = selected !== null && selected.decimals !== null && selected.quoteDecimals !== null && chainId !== null;
  const [filteredTrades, overlayControls] = useChartOverlayFilter(traders.recentLargeTrades);

  const layoutToggle = (
    <div className="mb-3 hidden items-center justify-end gap-2 lg:flex">
      <LayoutGrid className="h-3.5 w-3.5 text-ink-400" aria-hidden />
      <div className="inline-flex rounded-lg border border-line bg-surface p-1">
        {GRID_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setGridMode(mode)}
            aria-pressed={gridMode === mode}
            className={cn(
              'rounded-md px-3 py-1 font-mono text-xs font-medium transition-colors',
              gridMode === mode ? 'bg-accent text-accent-ink shadow-glow-accent' : 'text-ink-400 hover:text-ink-900',
            )}
          >
            {mode}-up
          </button>
        ))}
      </div>
    </div>
  );

  // Mobile always gets the single-terminal drawer layout below, regardless of gridMode —
  // the 1/4/6-up multi-chart grid is a "multi-monitor trading matrix" by its own design
  // (see GridTerminalCell's doc comment), which doesn't map onto a phone screen; the
  // layoutToggle buttons that change gridMode are themselves `lg:flex` (desktop-only), so
  // a mobile visitor can never actually set gridMode !== 1 in the first place — this guard
  // only matters for someone who set it on desktop and then resized the window down.
  if (isMobile) {
    return (
      <div>
        <div className="sticky top-0 z-30 mb-3 flex items-center gap-2 border-b border-line bg-bg/95 px-1 py-2 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setTokenListOpen(true)}
            className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-3 py-2 text-left font-display text-sm font-semibold text-ink-900"
          >
            {selected ? `$${selected.symbol ?? 'Token'}` : 'Pick a token'} <span className="text-ink-400">▾</span>
          </button>
          <button
            type="button"
            onClick={() => setTradeOpen(true)}
            disabled={!canTrade}
            className="shrink-0 rounded-lg bg-accent px-4 py-2 font-display text-sm font-bold text-accent-ink disabled:opacity-40"
          >
            Trade
          </button>
        </div>

        {selected && (
          <div className="mb-3">
            <TokenMetricsBar market={selected} />
          </div>
        )}

        <Surface variant="elevated" className="mb-3 flex h-[300px] flex-col gap-2 p-2 shadow-glow-accent">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {overlayControls}
            <InlineTimeframeTabs active={timeframe} onChange={setTimeframe} />
          </div>
          <div className="min-h-0 flex-1">
            {!selected ? (
              <EmptyState title="Pick a token to see its chart" />
            ) : candlesStatus === 'loading' ? (
              <Skeleton className="h-full w-full" />
            ) : candlesStatus === 'error' ? (
              <EmptyState title="Couldn't load this chart" detail="Try selecting the token again in a moment." />
            ) : (
              <KambyChart candles={candles} trades={filteredTrades} />
            )}
          </div>
        </Surface>

        <div className="mb-3 h-[300px]">
          {!selected ? (
            <div className="flex h-full items-center rounded-2xl border border-line bg-surface">
              <EmptyState title="Pick a token to see its activity" />
            </div>
          ) : activityStatus === 'loading' ? (
            <Skeleton className="h-full w-full rounded-2xl" />
          ) : activityStatus === 'error' ? (
            <div className="flex h-full items-center rounded-2xl border border-line bg-surface">
              <EmptyState title="Couldn't load activity" detail="Try selecting the token again in a moment." />
            </div>
          ) : (
            <DataHub activity={activity} />
          )}
        </div>

        <div className="mb-3">
          <MyPositionsPanel />
        </div>

        {selected && (
          <div className="mb-3 rounded-2xl border border-line bg-surface p-4">
            {tradersStatus === 'loading' ? (
              <Skeleton className="h-40 w-full" />
            ) : tradersStatus === 'error' ? (
              <EmptyState title="Couldn't load traders" detail="Try selecting the token again in a moment." />
            ) : (
              <TokenTradersPanel connection={traders} tokenAddress={selected.tokenAddress} chainId={chainIdFor(selected)} />
            )}
          </div>
        )}

        <MobileDrawer open={tokenListOpen} onClose={() => setTokenListOpen(false)} title="Tokens">
          <div className="h-[70vh]">
            <DiscoverTokenList
              ranked={ranked}
              trending={trending}
              movers={movers}
              byVolume={byVolume}
              selectedKey={selectedKey}
              onSelect={(market) => {
                handleSelect(market);
                setTokenListOpen(false);
              }}
              selectionDisabled={inFlight}
            />
          </div>
        </MobileDrawer>

        <MobileDrawer open={tradeOpen} onClose={() => setTradeOpen(false)} title="Trade">
          {canTrade && selected && chainId !== null ? (
            <TradePanelCard
              key={selectedKey ?? undefined}
              chainId={chainId}
              tokenAddress={selected.tokenAddress}
              tokenSymbol={selected.symbol}
              tokenDecimals={selected.decimals as number}
              quoteTokenAddress={selected.quoteAddress}
              quoteTokenSymbol={selected.quoteSymbol}
              quoteTokenDecimals={selected.quoteDecimals as number}
              onStepChange={setTradeStep}
            />
          ) : (
            <p className="font-body text-sm text-ink-600">
              {selected ? "Trading isn't available for this token yet." : 'Pick a token to trade.'}
            </p>
          )}
        </MobileDrawer>
      </div>
    );
  }

  if (gridMode !== 1) {
    const cellDefaults = availableMarkets.slice(0, gridMode);
    const gridColsClass = gridMode === 4 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3';
    const cellHeightClass = gridMode === 4 ? 'h-[620px]' : 'h-[560px]';
    return (
      <div>
        {layoutToggle}
        <div className={cn('grid grid-cols-1 gap-3', gridColsClass)}>
          {Array.from({ length: gridMode }).map((_, i) => (
            <div key={i} className={cellHeightClass}>
              <GridTerminalCell
                availableMarkets={availableMarkets}
                initialMarket={cellDefaults[i] ?? null}
                compact={gridMode === 6}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {layoutToggle}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr_340px]">
      <div className="h-[520px] lg:h-[calc(100vh-8rem)]">
        <DiscoverTokenList
          ranked={ranked}
          trending={trending}
          movers={movers}
          byVolume={byVolume}
          selectedKey={selectedKey}
          onSelect={handleSelect}
          selectionDisabled={inFlight}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {selected ? (
          <TokenMetricsBar market={selected} />
        ) : (
          <Surface variant="glass" className="p-4">
            <p className="font-body text-sm text-ink-600">Pick a token from the list to see it here.</p>
          </Surface>
        )}

        <Surface variant="elevated" className="flex h-[380px] flex-col gap-2 p-2 shadow-glow-accent">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {overlayControls}
            <InlineTimeframeTabs active={timeframe} onChange={setTimeframe} />
          </div>
          <div className="min-h-0 flex-1">
            {!selected ? (
              <EmptyState title="Pick a token to see its chart" />
            ) : candlesStatus === 'loading' ? (
              <Skeleton className="h-full w-full" />
            ) : candlesStatus === 'error' ? (
              <EmptyState title="Couldn't load this chart" detail="Try selecting the token again in a moment." />
            ) : (
              <KambyChart candles={candles} trades={filteredTrades} />
            )}
          </div>
        </Surface>

        <div className="h-[300px]">
          {!selected ? (
            <div className="flex h-full items-center rounded-2xl border border-line bg-surface">
              <EmptyState title="Pick a token to see its activity" />
            </div>
          ) : activityStatus === 'loading' ? (
            <Skeleton className="h-full w-full rounded-2xl" />
          ) : activityStatus === 'error' ? (
            <div className="flex h-full items-center rounded-2xl border border-line bg-surface">
              <EmptyState title="Couldn't load activity" detail="Try selecting the token again in a moment." />
            </div>
          ) : (
            <DataHub activity={activity} />
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {canTrade && selected && chainId !== null ? (
          <TradePanelCard
            key={selectedKey ?? undefined}
            chainId={chainId}
            tokenAddress={selected.tokenAddress}
            tokenSymbol={selected.symbol}
            tokenDecimals={selected.decimals as number}
            quoteTokenAddress={selected.quoteAddress}
            quoteTokenSymbol={selected.quoteSymbol}
            quoteTokenDecimals={selected.quoteDecimals as number}
            onStepChange={setTradeStep}
          />
        ) : (
          <Surface className="p-4">
            <p className="font-body text-sm text-ink-600">
              {selected ? "Trading isn't available for this token yet." : 'Pick a token to trade.'}
            </p>
          </Surface>
        )}

        <MyPositionsPanel />

        {!selected ? (
          <div className="flex items-center rounded-2xl border border-line bg-surface">
            <EmptyState title="No token selected" />
          </div>
        ) : tradersStatus === 'loading' ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : tradersStatus === 'error' ? (
          <div className="flex items-center rounded-2xl border border-line bg-surface">
            <EmptyState title="Couldn't load traders" detail="Try selecting the token again in a moment." />
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface p-4">
            <TokenTradersPanel connection={traders} tokenAddress={selected.tokenAddress} chainId={chainIdFor(selected)} />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
