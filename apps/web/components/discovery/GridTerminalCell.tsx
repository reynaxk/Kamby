'use client';

import { useEffect, useState } from 'react';
import {
  CHAIN_REGISTRY,
  DEFAULT_CHAIN_SLUG,
  slugForIdentifier,
  type Candle,
  type MarketSummary,
  type Timeframe,
} from '@kamby/domain';
import { Surface } from '@kamby/ui';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { KambyChart } from '@/components/terminal/KambyChart';
import { IN_FLIGHT_STEPS, TradePanelCard } from '@/components/terminal/TradePanelCard';
import { type TradePanelStep } from '@/components/trading/TradePanel';
import { PriceChange } from '@/components/market/PriceChange';
import { formatPrice } from '@/lib/format';
import { fetchTokenHistory } from '@/lib/market-client';
import { CellTokenSelector } from './CellTokenSelector';
import { InlineTimeframeTabs } from './InlineTimeframeTabs';

type FetchStatus = 'loading' | 'ready' | 'error';

function chainIdFor(market: MarketSummary): number {
  const slug = slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG;
  return CHAIN_REGISTRY[slug].numericId;
}

/**
 * One independent cell of the Multi-Chart Grid — its own token selection, its own candles
 * fetch, its own chart, its own full trade flow (TradePanelCard, reused unmodified). A real
 * multi-monitor trading matrix, not a shared view: switching this cell's token never
 * touches any other cell's state. Deliberately lighter than the single-terminal view —
 * no activity feed, no token-traders panel — there simply isn't room for six of each at
 * once; those stay a single-terminal-only feature (switch back to 1-up for deep research
 * on one token).
 *
 * Candles are the only per-cell fetch (activity/traders are dropped, see above), so this
 * needs its own race-guarded effect — same cancelled-flag pattern DiscoverTerminal and
 * TrenchesPanel already use, just scoped to one cell instead of one shared terminal.
 */
export function GridTerminalCell({
  availableMarkets,
  initialMarket,
  compact,
}: {
  availableMarkets: MarketSummary[];
  initialMarket: MarketSummary | null;
  /** 6-up cells get a shorter chart/panel budget than 4-up — same component, tighter frame. */
  compact?: boolean;
}) {
  const [selected, setSelected] = useState<MarketSummary | null>(initialMarket);
  const [timeframe, setTimeframe] = useState<Timeframe>('1D');
  const [tradeStep, setTradeStep] = useState<TradePanelStep>('form');
  const inFlight = IN_FLIGHT_STEPS.has(tradeStep);

  const [candles, setCandles] = useState<Candle[]>([]);
  const [candlesStatus, setCandlesStatus] = useState<FetchStatus>('loading');

  useEffect(() => {
    if (!selected) {
      setCandles([]);
      return;
    }
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

  function handleSelect(market: MarketSummary) {
    if (inFlight) return;
    setSelected(market);
    setTradeStep('form');
  }

  const chainId = selected ? chainIdFor(selected) : null;
  const canTrade = selected !== null && selected.decimals !== null && selected.quoteDecimals !== null && chainId !== null;
  const selectedKey = selected ? `${selected.chainIdentifier}:${selected.tokenAddress}` : null;
  const chartHeight = compact ? 'h-[160px]' : 'h-[220px]';

  return (
    <Surface variant="elevated" className="flex h-full flex-col gap-2 p-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <CellTokenSelector
            availableMarkets={availableMarkets}
            selected={selected}
            onSelect={handleSelect}
            disabled={inFlight}
          />
        </div>
        {selected && (
          <div className="flex shrink-0 items-baseline gap-1.5 font-mono text-xs tabular-nums">
            <span className="font-semibold text-ink-900">{formatPrice(selected.priceUsd)}</span>
            <PriceChange value={selected.priceChange24hPct} className="text-xs" />
          </div>
        )}
      </div>

      {!compact && (
        <div className="flex justify-end">
          <InlineTimeframeTabs active={timeframe} onChange={setTimeframe} />
        </div>
      )}

      <div className={`${chartHeight} rounded-lg border border-line bg-bg`}>
        {!selected ? (
          <EmptyState title="Pick a token" />
        ) : candlesStatus === 'loading' ? (
          <Skeleton className="h-full w-full" />
        ) : candlesStatus === 'error' ? (
          <EmptyState title="Couldn't load chart" />
        ) : (
          <KambyChart candles={candles} />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
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
          <p className="p-2 font-body text-xs text-ink-400">
            {selected ? "Trading isn't available for this token yet." : 'Pick a token to trade.'}
          </p>
        )}
      </div>
    </Surface>
  );
}
