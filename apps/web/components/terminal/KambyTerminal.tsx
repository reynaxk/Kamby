'use client';

import { useState } from 'react';
import { SocialFeed } from '@/components/trading/SocialFeed';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import { DataHub } from './DataHub';
import { KambyChart } from './KambyChart';
import { DEFAULT_MOCK_TOKEN, MOCK_TRENDING_TOKENS } from './mock-data';
import { PositionsBar } from './PositionsBar';
import { PreviewBanner } from './PreviewBanner';
import { SmartSlipGasBar } from './SmartSlipGasBar';
import { TokenMetricsBar } from './TokenMetricsBar';
import { TokenOverviewCard } from './TokenOverviewCard';
import { TrendingTokensSidebar } from './TrendingTokensSidebar';

/**
 * The full 3-column DEX terminal layout, as a design/layout preview — see PreviewBanner
 * for what's mock vs. real. Left (trending list) and center (chart, data hub) are entirely
 * mock; the right column's swap widget is the REAL `SolanaTradePanel` already live at
 * `/solana`, always trading real SOL/USDC regardless of which mock token is "selected" on
 * the left — selecting a mock trending token changes what the chart/metrics/overview show,
 * not what the widget actually trades, since there's no real market behind any mock ticker
 * to trade against yet.
 *
 * `SocialFeed` in the right column is a genuine exception to all of that: it's real,
 * already-live activity data (see SocialFeed.tsx's own doc comment) — Base (EVM) swaps
 * specifically, not Solana, since that's the only chain with this data pipeline built.
 */
export function KambyTerminal() {
  const [selectedId, setSelectedId] = useState(DEFAULT_MOCK_TOKEN.id);
  const selectedToken = MOCK_TRENDING_TOKENS.find((t) => t.id === selectedId) ?? DEFAULT_MOCK_TOKEN;

  return (
    <div className="min-h-screen pb-28 lg:pb-0">
      <PreviewBanner />
      <div className="mx-auto max-w-[1600px] p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr_340px]">
          <div className="hidden lg:block">
            <div className="sticky top-3 h-[calc(100vh-6rem)]">
              <TrendingTokensSidebar selectedId={selectedId} onSelect={setSelectedId} />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <TokenMetricsBar token={selectedToken} />
            <div className="h-[380px] rounded-2xl border border-line bg-surface p-2">
              <KambyChart />
            </div>
            <div className="h-[300px]">
              <DataHub />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <SmartSlipGasBar />
              <div className="mt-3">
                <SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />
              </div>
              <p className="mt-2 font-mono text-[0.6rem] text-ink-400">
                Preview always trades real SOL/USDC here, regardless of the token selected on the left — per-token
                trading ships once Solana markets are tracked.
              </p>
            </div>
            <TokenOverviewCard token={selectedToken} />
            <div className="h-[360px]">
              <SocialFeed />
            </div>
          </div>
        </div>
      </div>
      <PositionsBar />
    </div>
  );
}
