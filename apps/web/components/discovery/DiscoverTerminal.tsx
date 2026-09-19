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
import { Surface } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { DataHub } from '@/components/terminal/DataHub';
import { KambyChart } from '@/components/terminal/KambyChart';
import { TokenMetricsBar } from '@/components/terminal/TokenMetricsBar';
import { IN_FLIGHT_STEPS, TradePanelCard } from '@/components/terminal/TradePanelCard';
import { type TradePanelStep } from '@/components/trading/TradePanel';
import { fetchTokenTraders } from '@/lib/discovery-client';
import { fetchTokenHistory } from '@/lib/market-client';
import { fetchLatestActivity } from '@/lib/social-client';
import { DiscoverTokenList } from './DiscoverTokenList';
import { InlineTimeframeTabs } from './InlineTimeframeTabs';
import { TokenTradersPanel } from './TokenTradersPanel';

type FetchStatus = 'loading' | 'ready' | 'error';

function chainIdFor(market: MarketSummary): number {
  const slug = slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG;
  return CHAIN_REGISTRY[slug].numericId;
}

function marketKey(market: MarketSummary): string {
  return `${market.chainIdentifier}:${market.tokenAddress}`;
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

  return (
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
          <div className="flex justify-end">
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
              <KambyChart candles={candles} />
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
            <TokenTradersPanel connection={traders} />
          </div>
        )}
      </div>
    </div>
  );
}
