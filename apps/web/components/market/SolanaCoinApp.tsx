'use client';

import type { Candle } from '@kamby/domain';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatCompactCount } from '@/lib/format';
import { MobileCoinScreen } from './MobileCoinScreen';
import { NewListingBanner } from './NewListingBanner';
import { CoinInfoTab } from './CoinInfoTab';
import { TokenChartCard } from '@/components/terminal/TokenChartCard';
import { HoldersPanel } from '@/components/terminal/HoldersPanel';
import { LiveTradesPanel } from '@/components/terminal/LiveTradesPanel';
import { MyPositionsPanel } from '@/components/discovery/MyPositionsPanel';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import type { ChartSource, ChartTimeframe } from '@/lib/chart-data';

/** A Solana coin's phone app screen — see MobileCoinScreen. */
export function SolanaCoinApp({
  mint,
  symbol,
  name,
  logoUrl,
  initialPrice,
  change24hPct,
  marketCapUsd,
  isNewListing,
  onBondingCurve,
  timeframe,
  timeframes,
  candles,
}: {
  mint: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  initialPrice: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
  isNewListing: boolean;
  onBondingCurve: boolean;
  timeframe: ChartTimeframe;
  timeframes: readonly ChartTimeframe[];
  candles: Candle[];
}) {
  const tC = useTranslations('coin');
  const tL = useTranslations('labels');
  const tU = useTranslations('ui');
  const source: ChartSource = { kind: 'solana', mint };
  const [holderCount, setHolderCount] = useState<number | null>(null);
  return (
    <MobileCoinScreen
      symbol={symbol}
      name={name}
      logoUrl={logoUrl}
      chainIdentifier="solana"
      address={mint}
      source={source}
      initialPrice={initialPrice}
      initialChange24hPct={change24hPct}
      initialMarketCapUsd={marketCapUsd}
      banner={isNewListing ? <NewListingBanner onBondingCurve={onBondingCurve} compact /> : undefined}
      chart={<TokenChartCard bare source={source} initialTimeframe={timeframe} initialCandles={candles} timeframes={timeframes} className="h-full" />}
      tabs={[
        { id: 'holders', label: tC('holders'), badge: holderCount !== null ? formatCompactCount(holderCount) : undefined, content: <HoldersPanel source={source} onCount={setHolderCount} /> },
        { id: 'trades', label: tU('trades_18da'), content: <LiveTradesPanel source={source} /> },
        {
          id: 'about',
          label: tL('tab_about'),
          content: (
            <div className="flex flex-col gap-3 px-4 pt-3">
              <MyPositionsPanel />
              <CoinInfoTab source={source} chain="solana" address={mint} chainIdentifier="solana" symbol={symbol} fallback={{ marketCapUsd }} />
            </div>
          ),
        },
      ]}
      canTrade
      renderTrade={(side) => <SolanaTradePanel tokenMint={mint} tokenSymbol={symbol} initialSide={side} volatile={isNewListing || onBondingCurve} sheet />}
    />
  );
}
