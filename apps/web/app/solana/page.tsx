import { MarketHeader } from '@/components/market/MarketHeader';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';

export const metadata = { title: 'Solana — Kamby' };

/**
 * Launch scope's one entry point for Solana trading — see docs/TRADING.md#solana. Fixed to
 * SOL (wrapped SOL's mint, `So111...112`) for now rather than a token picker: this exists
 * to prove the real pipeline end to end (Privy login → wallet verify → Jupiter quote →
 * sign & send → confirm), not as the final placement. A proper per-token entry point
 * (mirroring how TradeButton/TradeModal work for EVM markets) is follow-up work once
 * Solana has its own tracked markets to link from.
 */
export default function SolanaPage() {
  return (
    <>
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
    </>
  );
}
