'use client';

import { useState } from 'react';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { cn } from '@kamby/ui';
import { useAccount } from 'wagmi';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import type { BadgeChain } from '@/components/market/ChainBadge';
import { useTranslations } from 'next-intl';
import { FundModal } from '@/components/wallet/FundModal';
import { useUsdcBalances } from '@/lib/use-usdc-balance';


/**
 * One quiet line under a buy's amount box: this chain's own USDC (2026-10-05 — traders saw
 * one header total, then "you have $0.00" on another chain's coin). Muted when there's
 * enough; green Deposit link when the chain is empty or short of the amount typed.
 */
export function ChainUsdcLine({ amountUsd = 0 }: { chain?: BadgeChain; amountUsd?: number }) {
  const tL = useTranslations('labels');
  const tF = useTranslations('fund');
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const { hidden } = useBalanceVisibility();
  const [open, setOpen] = useState(false);
  // One USDC (2026-10-13): the total across every chain — Kamby moves it where a buy needs it.
  const amount = balances.total;
  if (amount === null) return null;
  const short = amount < 0.01 || amount < amountUsd;

  return (
    <div className={cn('flex items-center gap-1.5 font-mono text-[0.72rem]', short ? 'text-ink-600' : 'text-ink-400')}>
      <span>
        {tL('yourUsdcLine', { amount: '' })}
        <span className={cn('font-semibold tabular-nums', short ? 'text-ink-900' : 'text-ink-600', hidden && 'select-none blur-sm')}>${amount.toFixed(2)}</span>
      </span>
      {short && (
        <button type="button" onClick={() => setOpen(true)} className="ml-auto font-display font-bold text-accent hover:underline">
          {tF('deposit')}
        </button>
      )}
      <FundModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
