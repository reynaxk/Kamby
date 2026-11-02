'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { FundModal } from './FundModal';
import { useNativeTrading } from '@/lib/native-trading';
import { useWalletTotalUsd } from './NativeBalancesList';
import { WalletChains } from './WalletChains';

/**
 * The signed-in header's balance (2026-10-03, user's spec): one USDC total across Base, BNB
 * Chain and Solana — "$0.00" for a brand-new wallet — and the way into Deposit. Honors "hide
 * balances".
 */
export function UsdcBalancePill() {
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const { total: usdcTotal } = useUsdcBalances(address, wallets[0]?.address);
  // 2026-11-01: with native-coin trading, the pill is every coin's dollar value plus any USDC.
  const native = useNativeTrading();
  const walletTotal = useWalletTotalUsd();
  const total = native ? walletTotal : usdcTotal;
  const { hidden } = useBalanceVisibility();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  // Native mode (2026-11-02): the pill opens the wallet — chain chips, the picked chain, Deposit / Withdraw.
  useEffect(() => {
    if (!open || !native) return;
    const away = (e: PointerEvent) => {
      // Clicks inside a modal opened from the panel (portalled) must not close it.
      const t = e.target as HTMLElement;
      if (!wrap.current?.contains(t) && !t.closest('[role=dialog]')) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, native]);

  if (!authenticated || !address) return null;
  const label = hidden ? '••••' : `$${(total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Wrapped in a span: the terminal header styles its direct child buttons as small square
  // icons (globals.css .kamby-header-actions > button), which crushed this pill.
  return (
    <span ref={wrap} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={native ? open : undefined}
        aria-label={`USDC balance ${hidden ? 'hidden' : label} — deposit`}
        className="flex items-center gap-1.5 rounded-full border border-line bg-surface-raised py-1 pl-3 pr-1 font-mono text-sm font-semibold tabular-nums text-ink-900 transition-colors hover:border-accent/60"
      >
        {label}
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-ink" aria-hidden>
          <Plus className="h-3.5 w-3.5" />
        </span>
      </button>
      {native ? (
        open && (
          <div className="absolute right-0 top-full z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/[0.08] bg-surface p-3.5 shadow-2xl">
            <WalletChains />
          </div>
        )
      ) : (
        <FundModal open={open} onClose={() => setOpen(false)} />
      )}
    </span>
  );
}
