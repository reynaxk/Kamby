'use client';

import { useState } from 'react';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { cn } from '@kamby/ui';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';
import { FundModal } from '@/components/wallet/FundModal';
import { useUsdcBalances } from '@/lib/use-usdc-balance';

const NAMES: Record<BadgeChain, string> = { solana: 'Solana', base: 'Base', bnb: 'BNB Chain' };

/**
 * One quiet line under a buy's amount box: this chain's own USDC (2026-10-05 — traders saw
 * one header total, then "you have $0.00" on another chain's coin). Muted when there's
 * enough; green Deposit link when the chain is empty or short of the amount typed.
 */
export function ChainUsdcLine({ chain, amountUsd = 0 }: { chain: BadgeChain; amountUsd?: number }) {
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  const [open, setOpen] = useState(false);
  const amount = balances[chain];
  if (amount === null) return null;
  const short = amount < 0.01 || amount < amountUsd;

  return (
    <div className={cn('flex items-center gap-1.5 font-mono text-[0.72rem]', short ? 'text-ink-600' : 'text-ink-400')}>
      <span className="relative h-3.5 w-3.5 shrink-0">
        <ChainBadge chain={chain} className="!static !h-3.5 !w-3.5 !ring-0" />
      </span>
      <span>
        USDC on {NAMES[chain]}:{' '}
        <span className={cn('font-semibold tabular-nums', short ? 'text-ink-900' : 'text-ink-600', hidden && 'select-none blur-sm')}>${amount.toFixed(2)}</span>
      </span>
      {short && (
        <button type="button" onClick={() => setOpen(true)} className="ml-auto font-display font-bold text-[#00FF87] hover:underline">
          Deposit on {NAMES[chain]}
        </button>
      )}
      <FundModal open={open} onClose={() => setOpen(false)} initialChain={chain} />
    </div>
  );
}
