import { MarketHeader } from '@/components/market/MarketHeader';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';

export const metadata = { title: 'Solana — Kamby' };
// Entirely wallet/session-scoped — nothing here has a meaningful static version, and
// statically prerendering it depends on wagmi/Privy's provider tree initializing during the
// build itself, which is a real, Linux-build-only crash (works fine on the Windows machine
// this app has always been deployed from) — see docs/TESTING.md's CI incident notes.
export const dynamic = 'force-dynamic';

/**
 * Launch scope's one entry point for Solana trading — see docs/TRADING.md#solana. Fixed to
 * SOL (wrapped SOL's mint, `So111...112`) for now rather than a token picker: this exists
 * to prove the real pipeline end to end (Privy login → wallet verify → Jupiter quote →
 * sign & send → confirm), not as the final placement. A proper per-token entry point
 * (mirroring how TradeButton/TradeModal work for EVM markets) is follow-up work once
 * Solana has its own tracked markets to link from.
 *
 * `kamby-void` scopes the Void dark theme (see globals.css) to this page — as of
 * 2026-09-15 also applied to Discover and Market detail, with the rest of the product
 * (Trades, Watchlist, Referrals, Notifications) still on the original light/dark palette.
 * `ToastProvider` is likewise scoped here rather than in the root `app/providers.tsx`,
 * since the trade panel is its only consumer so far.
 */
export default function SolanaPage() {
  return (
    <ToastProvider>
      <div className="kamby-void min-h-screen bg-bg">
        <MarketHeader />
        <main className="mx-auto max-w-md px-6 py-10">
          <h1 className="font-display text-xl font-bold text-ink-900">Trade on Solana</h1>
          <p className="mt-1 font-body text-sm text-ink-600">
            Sign in with email — no wallet app needed. Kamby creates one for you.
          </p>
          <div className="mt-6 rounded-2xl border border-line bg-surface p-4">
            <SolanaTradePanel tokenMint="So11111111111111111111111111111111111111112" tokenSymbol="SOL" />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
