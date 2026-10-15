'use client';

import { CoinInfoTab } from '@/components/market/CoinInfoTab';

import { useMemo, useState } from 'react';
import { formatCompactCount } from '@/lib/format';
import { isCuratedMarket, type Candle, type MarketSummary, type SocialActivity, type TokenTraderConnection } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import { MyPositionsPanel } from '@/components/discovery/MyPositionsPanel';
import { MarketInfoPanel } from './MarketInfoPanel';
import { TokenTradersPanel } from '@/components/discovery/TokenTradersPanel';
import { useIsMobile } from '@/hooks/useIsMobile';
import { DataHub } from './DataHub';
import { TerminalLeftRail } from './TerminalLeftRail';
import { TokenMetricsBar } from './TokenMetricsBar';
import { TradePanelCard } from './TradePanelCard';
import type { ChartSource, ChartTimeframe } from '@/lib/chart-data';
import { TokenChartCard } from './TokenChartCard';
import { useTranslations } from 'next-intl';
import { MobileCoinScreen } from '@/components/market/MobileCoinScreen';
import { HoldersPanel } from './HoldersPanel';
import { LiveTradesPanel } from './LiveTradesPanel';
import { CurveTradePanel } from '@/components/trading/CurveTradePanel';
import { TokenStreamChatLazy } from '@/components/chat/TokenStreamChatLazy';
import { WatchButton } from '@/components/market/WatchButton';

/**
 * The full 3-column Void-theme terminal layout — ported to production 2026-09-16 (was a
 * design/layout preview at the now-retired `/solana/terminal`, see git history for
 * PreviewBanner.tsx). This *is* the market detail page now
 * (app/market/[chain]/[address]/page.tsx renders it directly with the real data that page
 * already fetches), not a separate route — clicking a real `TrenchesPanel` row navigates
 * here via a real link, which is the only "token selection" this needed: no client-side
 * selection state, no second fetch.
 *
 * Every column is real data now. Two things were deliberately dropped rather than given an
 * honest placeholder, because there's nothing to eventually fill them with: the old
 * `TokenOverviewCard` (a buy/sell split with no backing field anywhere in
 * `MarketSummarySchema`) and the mock preview's `PositionsBar` (needs real position/PnL
 * tracking that doesn't exist in the backend — its own doc comment already said so). Two
 * `DataHub` tabs (holders, caller-alpha) do get an honest "— soon", matching
 * `SmartSlipGasBar`'s own Jito-tip/Anti-MEV pattern, since those *are* real planned
 * features with just no data source yet.
 *
 * The right column's `SolanaTradePanel` is now the EVM `TradePanel` — `MarketSummary` is
 * EVM-only (no Solana market-detail page exists or is in scope here), so this terminal only
 * ever renders for a Base/BNB token. `SocialFeed` (Kamby's *global Solana* activity feed) is
 * gone from here for the same reason: showing unrelated Solana trades on a Base/BNB token's
 * page was never going to make sense. `TokenTradersPanel` takes its place — real, already
 * fetched by the same page, and a genuinely different view (top traders, not a raw feed)
 * than `DataHub`'s own Transactions tab, not a duplicate of it.
 *
 * `'use client'` (added alongside the mobile layout below) purely for `useIsMobile()` — every
 * child here was already a Client Component, and no server-only data fetching ever happened
 * in this wrapper itself (the page that renders KambyTerminal does that, passing props down),
 * so this costs nothing real. Below `lg`, the left rail used to just be `hidden` entirely —
 * not simplified, just genuinely unreachable on mobile; it and the trade panel are now both
 * MobileDrawer sheets instead, same "make the trading panel a drawer" treatment
 * DiscoverTerminal's own mobile layout uses.
 *
 * Left rail is `TerminalLeftRail` (Trenches/Traders tabs), not a bare `TrenchesPanel`, as of
 * 2026-09-22 — real mismatch caught comparing against production: TrenchesPanel is Solana-
 * only, so it showed Pump.fun bonding-curve data even on a Base/BNB token's own page. See
 * that component's own doc comment for why it's a smaller sibling of DiscoverTokenList.tsx's
 * tab strip, not a reuse of it.
 */
export function KambyTerminal({
  chainId,
  chain,
  market,
  candles,
  activity,
  traders,
  timeframe,
  banner,
}: {
  chainId: number;
  chain: string;
  market: MarketSummary;
  candles: Candle[];
  activity: SocialActivity[];
  traders: TokenTraderConnection;
  timeframe: ChartTimeframe;
  /** The new-listing warning, shown under the price on the phone screen. */
  banner?: React.ReactNode;
}) {
  const tU = useTranslations('ui');
  const isMobile = useIsMobile();
  const tL = useTranslations('labels');
  const tC = useTranslations('coin');
  const tChat = useTranslations('tokenChat');
  const [holderCount, setHolderCount] = useState<number | null>(null);
  const canTrade = market.decimals !== null && market.quoteDecimals !== null;
  const chartSource = useMemo<ChartSource>(
    () => ({ kind: 'evm', chain: chain === 'bnb' ? 'bnb' : chain === 'robinhood' ? 'robinhood' : 'base', address: market.tokenAddress, chainId }),
    [chain, market.tokenAddress, chainId],
  );

  // Four.meme coins still on their bonding curve (dex 'fourmeme' until the workers see them graduate).
  const onCurve = market.dex === 'fourmeme';
  const tradePanel = onCurve ? (
    <Surface className="p-4">
      <CurveTradePanel tokenAddress={market.tokenAddress} tokenSymbol={market.symbol} />
    </Surface>
  ) : canTrade ? (
    <TradePanelCard
      chainId={chainId}
      tokenAddress={market.tokenAddress}
      tokenSymbol={market.symbol}
      tokenDecimals={market.decimals as number}
      quoteTokenAddress={market.quoteAddress}
      quoteTokenSymbol={market.quoteSymbol}
      quoteTokenDecimals={market.quoteDecimals as number}
      volatile={!isCuratedMarket(market.chainIdentifier, market.tokenAddress)}
    />
  ) : (
    <Surface className="p-4">
      <p className="font-body text-sm text-ink-600">{tU('tradingIsnTAvailableFor_74f9')}</p>
    </Surface>
  );

  if (isMobile) {
    return (
      <MobileCoinScreen
        symbol={market.symbol}
        name={market.name}
        logoUrl={market.logoUrl}
        chainIdentifier={market.chainIdentifier}
        address={market.tokenAddress}
        source={chartSource}
        initialPrice={market.priceUsd}
        initialChange24hPct={market.priceChange24hPct}
        initialMarketCapUsd={market.marketCapUsd}
        watch={<WatchButton address={market.tokenAddress} chainId={chainId} initialWatching={null} compact />}
        banner={banner}
        chart={<TokenChartCard bare source={chartSource} initialTimeframe={timeframe} initialCandles={candles} trades={traders.recentLargeTrades} className="h-full" />}
        tabs={[
          { id: 'holders', label: tC('holders'), badge: holderCount !== null ? formatCompactCount(holderCount) : undefined, content: <HoldersPanel source={chartSource} onCount={setHolderCount} /> },
          {
            id: 'chat',
            label: tChat('tab'),
            content: <TokenStreamChatLazy chainIdentifier={market.chainIdentifier} address={market.tokenAddress} symbol={market.symbol} phone className="h-[560px]" />,
          },
          { id: 'trades', label: tU('trades_18da'), content: <LiveTradesPanel source={chartSource} /> },
          { id: 'traders', label: tU('traders_d5d8'), content: <div className="px-4 pt-3"><TokenTradersPanel connection={traders} tokenAddress={market.tokenAddress} chainId={chainId} /></div> },
          {
            id: 'about',
            label: tL('tab_about'),
            content: (
              <div className="flex flex-col gap-3 px-4 pt-3">
                <MyPositionsPanel />
                <CoinInfoTab
                  source={chartSource}
                  chain={chain === 'bnb' ? 'bnb' : chain === 'robinhood' ? 'robinhood' : 'base'}
                  address={market.tokenAddress}
                  chainIdentifier={market.chainIdentifier}
                  symbol={market.symbol}
                  fallback={{ marketCapUsd: market.marketCapUsd, liquidityUsd: market.liquidityUsd }}
                />
              </div>
            ),
          },
        ]}
        canTrade={canTrade || onCurve}
        renderTrade={(side) => onCurve ? (
          <div className="px-1 pb-2">
            <CurveTradePanel key={side} tokenAddress={market.tokenAddress} tokenSymbol={market.symbol} initialSide={side} />
          </div>
        ) : (
          <TradePanelCard
            key={side}
            sheet
            initialSide={side}
            chainId={chainId}
            tokenAddress={market.tokenAddress}
            tokenSymbol={market.symbol}
            tokenDecimals={market.decimals as number}
            quoteTokenAddress={market.quoteAddress}
            quoteTokenSymbol={market.quoteSymbol}
            quoteTokenDecimals={market.quoteDecimals as number}
            volatile={!isCuratedMarket(market.chainIdentifier, market.tokenAddress)}
          />
        )}
      />
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr_340px]">
          <div className="hidden lg:block">
            <div className="sticky top-3 h-[calc(100vh-6rem)]">
              <TerminalLeftRail />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <TokenMetricsBar market={market} />
            {/* The visual hero of the terminal — elevated + a restrained accent glow rather
                than glass: lightweight-charts renders to a <canvas>, so nothing sits behind
                this card for a backdrop-blur to reveal. */}
            <TokenChartCard
              source={chartSource}
              initialTimeframe={timeframe}
              initialCandles={candles}
              trades={traders.recentLargeTrades}
              className="h-[320px]"
            />
            <div className="h-[300px]">
              <DataHub activity={activity} source={chartSource} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Same guard as the old page.tsx layout — decimals are nullable
                (MarketSummarySchema) until the ingestion worker has resolved them live from
                the token contract; never pass a null decimals into TradePanel. */}
            {tradePanel}
            <div className="h-[440px] overflow-hidden rounded-2xl border border-line bg-surface">
              <TokenStreamChatLazy chainIdentifier={market.chainIdentifier} address={market.tokenAddress} symbol={market.symbol} className="h-full" />
            </div>
            <MyPositionsPanel />
            <MarketInfoPanel market={market} />
            <div className="rounded-2xl border border-line bg-surface p-4">
              <TokenTradersPanel connection={traders} tokenAddress={market.tokenAddress} chainId={chainId} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
