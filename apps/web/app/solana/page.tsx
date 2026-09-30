import { MarketHeader } from '@/components/market/MarketHeader';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import { NewListingBanner } from '@/components/market/NewListingBanner';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import Link from 'next/link';
import { cn } from '@kamby/ui';
import { KambyChart } from '@/components/terminal/KambyChart';
import { fetchDiscoverMarkets, fetchPumpFunToken, fetchSolanaHistory, SOLANA_CHART_TIMEFRAMES, type SolanaChartTimeframe } from '@/lib/market-api';
import { formatPercent, formatPrice } from '@/lib/format';

// Entirely wallet/session-scoped — nothing here has a meaningful static version, and
// statically prerendering it depends on wagmi/Privy's provider tree initializing during the
// build itself, which is a real, Linux-build-only crash (works fine on the Windows machine
// this app has always been deployed from) — see docs/TESTING.md's CI incident notes.
export const dynamic = 'force-dynamic';

/**
 * Kamby's Solana trading page — see docs/TRADING.md#solana. Defaults to SOL; `?mint=` opens
 * a curated Solana market (BONK/WIF/JUP-class) or a coin that graduated from Pump.fun
 * (Discover's Graduated tab) instead — see resolveMarket below. A full chart/detail page per
 * Solana token, mirroring /market/[chain]/[address], is still follow-up work.
 *
 * `kamby-void` scopes the Void dark theme (see globals.css) to this page — as of
 * 2026-09-15 also applied to Discover and Market detail, with the rest of the product
 * (Trades, Watchlist, Referrals, Notifications) still on the original light/dark palette.
 * `ToastProvider` is likewise scoped here rather than in the root `app/providers.tsx`,
 * since the trade panel is its only consumer so far.
 */
interface SolanaTradeTarget {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  /** A Pump.fun graduate — found automatically, not hand-picked; shows the risk banner. */
  isNewListing: boolean;
  priceChange24hPct: number | null;
}

const NATIVE_SOL: SolanaTradeTarget = { tokenAddress: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', logoUrl: null, isNewListing: false, priceChange24hPct: null };

/** `?mint=` only ever resolves to a coin Kamby itself vouches for — never an arbitrary mint
 *  from the URL, so a shared link can't dress an unknown token up as a Kamby market:
 *  1. a curated Solana market (the SolanaTokenMarket rows in /market/discover), or
 *  2. a Pump.fun coin Kamby watched graduate (`complete`). A coin still on its bonding curve
 *     is never offered — those stay browse-only (a product decision, 2026-09-30).
 *  Anything else falls back to SOL. */
async function resolveMarket(mint: string | undefined): Promise<SolanaTradeTarget> {
  if (!mint || mint === NATIVE_SOL.tokenAddress) return NATIVE_SOL;
  const markets = await fetchDiscoverMarkets({ sort: 'score', limit: 100 });
  const found = markets.find((m) => m.chainIdentifier === 'solana' && m.tokenAddress === mint);
  if (found) return { tokenAddress: found.tokenAddress, symbol: found.symbol, name: found.name, logoUrl: found.logoUrl, isNewListing: false, priceChange24hPct: found.priceChange24hPct };
  const pumpFun = await fetchPumpFunToken(mint);
  if (pumpFun?.complete) return { tokenAddress: pumpFun.mintAddress, symbol: pumpFun.symbol, name: pumpFun.name, logoUrl: null, isNewListing: true, priceChange24hPct: null };
  return NATIVE_SOL;
}

export async function generateMetadata({ searchParams }: { searchParams: { mint?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  return { title: market === NATIVE_SOL ? 'Solana — Kamby' : `${market.symbol ?? 'Token'} on Solana — Kamby` };
}

function isChartTimeframe(value: string | undefined): value is SolanaChartTimeframe {
  return (SOLANA_CHART_TIMEFRAMES as readonly string[]).includes(value ?? '');
}

export default async function SolanaPage({ searchParams }: { searchParams: { mint?: string; timeframe?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  const isSol = market === NATIVE_SOL;
  const timeframe: SolanaChartTimeframe = isChartTimeframe(searchParams.timeframe) ? searchParams.timeframe : '1H';
  const candles = await fetchSolanaHistory(market.tokenAddress, timeframe);
  const lastClose = candles.at(-1)?.close ?? null;
  const tabHref = (tf: SolanaChartTimeframe) => `/solana?${new URLSearchParams({ ...(isSol ? {} : { mint: market.tokenAddress }), timeframe: tf }).toString()}`;

  return (
    <ToastProvider>
      <div className="kamby-void min-h-screen bg-bg">
        <MarketHeader />
        {/* Chart first, trade panel second — stacked on phones, side by side from lg up. */}
        <main className="mx-auto grid max-w-6xl grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-2">
              {isSol ? (
                <h1 className="font-display text-xl font-bold text-ink-900">Trade on Solana</h1>
              ) : (
                <h1 className="font-display text-xl font-bold text-ink-900">
                  <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="sm" />
                </h1>
              )}
              {lastClose !== null && (
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900">
                  {formatPrice(lastClose)}
                  {market.priceChange24hPct !== null && (
                    <span className={cn('ml-2 text-sm', market.priceChange24hPct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(market.priceChange24hPct)}</span>
                  )}
                </p>
              )}
            </div>
            {market.isNewListing && (
              <div className="mt-3">
                <NewListingBanner />
              </div>
            )}
            <div className="mt-3 rounded-2xl border border-line bg-surface p-2">
              <nav aria-label="Chart timeframe" className="flex gap-1 px-1 pb-2">
                {SOLANA_CHART_TIMEFRAMES.map((tf) => (
                  <Link
                    key={tf}
                    href={tabHref(tf)}
                    scroll={false}
                    aria-current={tf === timeframe ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-2 py-1 font-mono text-[0.7rem]',
                      tf === timeframe ? 'bg-accent font-semibold text-black' : 'text-ink-400 hover:text-ink-900',
                    )}
                  >
                    {tf}
                  </Link>
                ))}
              </nav>
              <div className="h-[320px] sm:h-[420px]">
                {candles.length > 0 ? (
                  <KambyChart candles={candles} />
                ) : (
                  <p className="flex h-full items-center justify-center font-body text-sm text-ink-400">No price history available right now.</p>
                )}
              </div>
            </div>
          </section>

          <aside>
            <p className="font-body text-sm text-ink-600">Sign in with email — no wallet app needed. Kamby creates one for you.</p>
            <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
              <SolanaTradePanel key={market.tokenAddress} tokenMint={market.tokenAddress} tokenSymbol={market.symbol} />
            </div>
          </aside>
        </main>
      </div>
    </ToastProvider>
  );
}
