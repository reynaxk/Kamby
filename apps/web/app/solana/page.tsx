import { MarketHeader } from '@/components/market/MarketHeader';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { fetchDiscoverMarkets } from '@/lib/market-api';

// Entirely wallet/session-scoped — nothing here has a meaningful static version, and
// statically prerendering it depends on wagmi/Privy's provider tree initializing during the
// build itself, which is a real, Linux-build-only crash (works fine on the Windows machine
// this app has always been deployed from) — see docs/TESTING.md's CI incident notes.
export const dynamic = 'force-dynamic';

/**
 * Kamby's Solana trading page — see docs/TRADING.md#solana. Defaults to SOL; `?mint=` opens
 * one of the curated Solana markets instead (BONK/WIF/JUP-class, linked from Discover's
 * lists — see resolveMarket above). A full chart/detail page per Solana token, mirroring
 * /market/[chain]/[address], is still follow-up work.
 *
 * `kamby-void` scopes the Void dark theme (see globals.css) to this page — as of
 * 2026-09-15 also applied to Discover and Market detail, with the rest of the product
 * (Trades, Watchlist, Referrals, Notifications) still on the original light/dark palette.
 * `ToastProvider` is likewise scoped here rather than in the root `app/providers.tsx`,
 * since the trade panel is its only consumer so far.
 */
const NATIVE_SOL = { tokenAddress: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Solana', logoUrl: null };

/** `?mint=` only ever resolves to a Solana market Kamby itself lists (the curated
 *  SolanaTokenMarket rows in /market/discover) — never an arbitrary mint from the URL, so a
 *  shared link can't dress an unvetted token up as a Kamby market. Anything else falls back
 *  to SOL. */
async function resolveMarket(mint: string | undefined) {
  if (!mint || mint === NATIVE_SOL.tokenAddress) return NATIVE_SOL;
  const markets = await fetchDiscoverMarkets({ sort: 'score', limit: 100 });
  const found = markets.find((m) => m.chainIdentifier === 'solana' && m.tokenAddress === mint);
  return found ? { tokenAddress: found.tokenAddress, symbol: found.symbol, name: found.name, logoUrl: found.logoUrl } : NATIVE_SOL;
}

export async function generateMetadata({ searchParams }: { searchParams: { mint?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  return { title: market === NATIVE_SOL ? 'Solana — Kamby' : `${market.symbol ?? 'Token'} on Solana — Kamby` };
}

export default async function SolanaPage({ searchParams }: { searchParams: { mint?: string } }) {
  const market = await resolveMarket(searchParams.mint);
  const isSol = market === NATIVE_SOL;
  return (
    <ToastProvider>
      <div className="kamby-void min-h-screen bg-bg">
        <MarketHeader />
        <main className="mx-auto max-w-md px-6 py-10">
          {isSol ? (
            <h1 className="font-display text-xl font-bold text-ink-900">Trade on Solana</h1>
          ) : (
            <h1 className="font-display text-xl font-bold text-ink-900">
              <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="sm" />
            </h1>
          )}
          <p className="mt-1 font-body text-sm text-ink-600">
            Sign in with email — no wallet app needed. Kamby creates one for you.
          </p>
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
            <SolanaTradePanel key={market.tokenAddress} tokenMint={market.tokenAddress} tokenSymbol={market.symbol} />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
