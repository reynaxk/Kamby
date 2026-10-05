import { MarketHeader } from '@/components/market/MarketHeader';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { TokenLinks } from '@/components/terminal/TokenLinks';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import { NewListingBanner } from '@/components/market/NewListingBanner';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { cn } from '@kamby/ui';
import { TokenChartCard } from '@/components/terminal/TokenChartCard';
import { HoldersPanel } from '@/components/terminal/HoldersPanel';
import { MyPositionsPanel } from '@/components/discovery/MyPositionsPanel';
import { CoinRail } from '@/components/discovery/CoinRail';
import { LivePriceText } from '@/components/market/LivePriceText';
import type { ChartTimeframe } from '@/lib/chart-data';
import { fetchDiscoverMarkets, fetchMarketFeeds, fetchPumpFunToken, fetchSolanaHistory, SOLANA_CHART_TIMEFRAMES, type SolanaChartTimeframe } from '@/lib/market-api';
import { formatPercent } from '@/lib/format';

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
  /** Still on a launchpad bonding curve — tradable through Jupiter, with a stronger warning. */
  onBondingCurve?: boolean;
  priceChange24hPct: number | null;
}

const NATIVE_SOL: SolanaTradeTarget = { tokenAddress: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', logoUrl: null, isNewListing: false, priceChange24hPct: null };

/** `?mint=` only ever resolves to a coin Kamby itself vouches for — never an arbitrary mint
 *  from the URL, so a shared link can't dress an unknown token up as a Kamby market:
 *  1. a Solana market Kamby lists (curated, or discovered from Jupiter's lists — looked up by
 *     its exact mint, not just the top of Discover), or
 *  2. a Pump.fun coin Kamby tracks — graduated, or still on its bonding curve (tradable since
 *     2026-10-03, with the stronger warning).
 *  Anything else falls back to SOL. */
async function resolveMarket(mint: string | undefined): Promise<SolanaTradeTarget> {
  if (!mint || mint === NATIVE_SOL.tokenAddress) return NATIVE_SOL;
  const markets = await fetchDiscoverMarkets({ sort: 'score', limit: 5, search: mint });
  const found = markets.find((m) => m.chainIdentifier === 'solana' && m.tokenAddress === mint);
  if (found) {
    const logoUrl = found.logoUrl ?? (await jupiterIcon(found.tokenAddress));
    return { tokenAddress: found.tokenAddress, symbol: found.symbol, name: found.name, logoUrl, isNewListing: false, priceChange24hPct: found.priceChange24hPct };
  }
  const pumpFun = await fetchPumpFunToken(mint);
  if (pumpFun) {
    return {
      tokenAddress: pumpFun.mintAddress,
      symbol: pumpFun.symbol,
      name: pumpFun.name,
      logoUrl: pumpFun.imageUrl ?? (await jupiterIcon(pumpFun.mintAddress)),
      isNewListing: true,
      onBondingCurve: !pumpFun.complete,
      priceChange24hPct: null,
    };
  }
  return NATIVE_SOL;
}

/** A coin's icon from Jupiter's free token search, when Kamby's listing has none (2026-10-05:
 *  brand-new Pump.fun coins showed initials). Cached an hour; never blocks the page on failure. */
async function jupiterIcon(mint: string): Promise<string | null> {
  try {
    const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const tokens = (await res.json()) as { id?: string; icon?: string }[];
    return tokens.find((t) => t.id === mint)?.icon ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ searchParams }: { searchParams: { mint?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  return { title: market === NATIVE_SOL ? 'Solana — Kamby' : `${market.symbol ?? 'Token'} on Solana — Kamby` };
}

const SOLANA_TIMEFRAMES: readonly ChartTimeframe[] = ['live', '10s', ...SOLANA_CHART_TIMEFRAMES];

function isChartTimeframe(value: string | undefined): value is SolanaChartTimeframe {
  return (SOLANA_CHART_TIMEFRAMES as readonly string[]).includes(value ?? '');
}

export default async function SolanaPage({ searchParams }: { searchParams: { mint?: string; timeframe?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  const isSol = market === NATIVE_SOL;
  const requested: ChartTimeframe =
    searchParams.timeframe === 'live' || searchParams.timeframe === '10s' ? searchParams.timeframe : isChartTimeframe(searchParams.timeframe) ? searchParams.timeframe : '1H';
  let timeframe = requested;
  let candles = await fetchSolanaHistory(market.tokenAddress, isChartTimeframe(timeframe) ? timeframe : '1m');
  // A brand-new coin has no candle history yet — open on 10s, built live from the price feed,
  // instead of an empty chart (2026-10-05). Only when the visitor didn't pick a width.
  if (candles.length < 2 && !searchParams.timeframe) {
    timeframe = '10s';
    candles = await fetchSolanaHistory(market.tokenAddress, '1m');
  }
  const lastClose = candles.at(-1)?.close ?? null;
  const feeds = await fetchMarketFeeds();

  return (
    <ToastProvider>
      <div className="kamby-void min-h-screen bg-bg">
        <MarketHeader />
        {/* Coin list on the left (xl and up, like the terminal), chart, then trade panel —
            stacked on phones. */}
        <main
          className={cn(
            'mx-auto grid grid-cols-1 gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]',
            feeds ? 'max-w-[1500px] xl:grid-cols-[320px_minmax(0,1fr)_380px]' : 'max-w-6xl',
          )}
        >
          {feeds && (
            <aside className="hidden h-[calc(100vh-7rem)] xl:sticky xl:top-4 xl:block">
              <CoinRail initial={feeds} selectedKey={`solana:${market.tokenAddress}`} />
            </aside>
          )}
          <section className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-2">
              {isSol ? (
                <h1 className="font-display text-xl font-bold text-ink-900">Trade on Solana</h1>
              ) : (
                <h1 className="font-display text-xl font-bold text-ink-900">
                  <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="sm" chainIdentifier="solana" seed={market.tokenAddress} />
                </h1>
              )}
              {!isSol && (
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900">
                  <LivePriceText mint={market.tokenAddress} initial={lastClose} />
                  {market.priceChange24hPct !== null && (
                    <span className={cn('ml-2 text-sm', market.priceChange24hPct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(market.priceChange24hPct)}</span>
                  )}
                </p>
              )}
            </div>
            {market.isNewListing && (
              <div className="mt-3">
                <NewListingBanner onBondingCurve={market.onBondingCurve} />
              </div>
            )}
            <TokenChartCard
              source={{ kind: 'solana', mint: market.tokenAddress }}
              initialTimeframe={timeframe}
              initialCandles={candles}
              timeframes={SOLANA_TIMEFRAMES}
              className="mt-3 h-[260px] sm:h-[320px]"
            />
            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface">
              <p className="border-b border-line px-3.5 py-2 font-display text-xs font-bold uppercase tracking-wide text-ink-900">Holders</p>
              <HoldersPanel source={{ kind: 'solana', mint: market.tokenAddress }} />
            </div>
          </section>

          <aside>
            <div className="rounded-2xl border border-line bg-surface p-4">
              <SolanaTradePanel key={market.tokenAddress} tokenMint={market.tokenAddress} tokenSymbol={market.symbol} volatile={market.isNewListing || Boolean(market.onBondingCurve)} />
            </div>
            <div className="mt-3">
              <MyPositionsPanel />
            </div>
            <TokenLinks chain="solana" address={market.tokenAddress} cardTitle={`About $${market.symbol}`} />
          </aside>
        </main>
      </div>
    </ToastProvider>
  );
}
