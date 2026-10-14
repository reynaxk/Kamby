import { MarketHeader } from '@/components/market/MarketHeader';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { LaunchPad } from '@/components/launch/LaunchPad';

export const metadata = { title: "Kamby's LaunchPad — create your coin" };
// Privy/wagmi hooks — no static version (same as the other signed-in pages).
export const dynamic = 'force-dynamic';

/** Kamby's LaunchPad (2026-10-14) — see components/launch/LaunchPad.tsx. */
export default function LaunchPage() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar title="Kamby's LaunchPad" fallback="/" />
      <LaunchPad />
    </div>
  );
}
