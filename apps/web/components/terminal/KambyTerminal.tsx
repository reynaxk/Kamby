import type { Candle, MarketSummary, SocialActivity, Timeframe, TokenTraderConnection } from '@kamby/domain';
import { TimeframeTabs } from '@/components/market/TimeframeTabs';
import { TradePanel } from '@/components/trading/TradePanel';
import { TokenTradersPanel } from '@/components/discovery/TokenTradersPanel';
import { DataHub } from './DataHub';
import { KambyChart } from './KambyChart';
import { SmartSlipGasBar } from './SmartSlipGasBar';
import { TokenMetricsBar } from './TokenMetricsBar';
import { TrenchesPanel } from './TrenchesPanel';

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
 */
export function KambyTerminal({
  chainId,
  chain,
  market,
  candles,
  activity,
  traders,
  timeframe,
}: {
  chainId: number;
  chain: string;
  market: MarketSummary;
  candles: Candle[];
  activity: SocialActivity[];
  traders: TokenTraderConnection;
  timeframe: Timeframe;
}) {
  return (
    <div className="min-h-screen pb-28 lg:pb-0">
      <div className="mx-auto max-w-[1600px] p-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr_340px]">
          <div className="hidden lg:block">
            <div className="sticky top-3 h-[calc(100vh-6rem)]">
              <TrenchesPanel />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <TokenMetricsBar market={market} />
            <div className="flex h-[380px] flex-col gap-2 rounded-2xl border border-line bg-surface p-2">
              <div className="flex justify-end">
                <TimeframeTabs chain={chain} address={market.tokenAddress} active={timeframe} />
              </div>
              <div className="min-h-0 flex-1">
                <KambyChart candles={candles} />
              </div>
            </div>
            <div className="h-[300px]">
              <DataHub activity={activity} />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div className="rounded-2xl border border-line bg-surface p-4">
              <SmartSlipGasBar />
              <div className="mt-3">
                {/* Same guard as the old page.tsx layout — decimals are nullable
                    (MarketSummarySchema) until the ingestion worker has resolved them live
                    from the token contract; never pass a null decimals into TradePanel. */}
                {market.decimals !== null && market.quoteDecimals !== null ? (
                  <TradePanel
                    chainId={chainId}
                    tokenAddress={market.tokenAddress}
                    tokenSymbol={market.symbol}
                    tokenDecimals={market.decimals}
                    quoteTokenAddress={market.quoteAddress}
                    quoteTokenSymbol={market.quoteSymbol}
                    quoteTokenDecimals={market.quoteDecimals}
                  />
                ) : (
                  <p className="font-body text-sm text-ink-600">Trading isn&apos;t available for this token yet.</p>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <TokenTradersPanel connection={traders} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
