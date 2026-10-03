'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { Plus } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { useUsdcBalances } from '@/lib/use-usdc-balance';
import { FundModal } from './FundModal';

/**
 * The signed-in header's balance (2026-10-03, user's spec): one USDC total across Base, BNB
 * Chain and Solana — "$0.00" for a brand-new wallet — and the way into Deposit. Honors "hide
 * balances".
 */
export function UsdcBalancePill() {
  const { authenticated } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const { total } = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  const [open, setOpen] = useState(false);

  if (!authenticated || !address) return null;
  const label = hidden ? '••••' : `$${(total ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Wrapped in a span: the terminal header styles its direct child buttons as small square
  // icons (globals.css .kamby-header-actions > button), which crushed this pill.
  return (
    <span className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`USDC balance ${hidden ? 'hidden' : label} — deposit`}
        className="flex items-center gap-1.5 rounded-full border border-line bg-surface-raised py-1 pl-3 pr-1 font-mono text-sm font-semibold tabular-nums text-ink-900 transition-colors hover:border-accent/60"
      >
        {label}
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-ink" aria-hidden>
          <Plus className="h-3.5 w-3.5" />
        </span>
      </button>
      <FundModal open={open} onClose={() => setOpen(false)} />
    </span>
  );
}
