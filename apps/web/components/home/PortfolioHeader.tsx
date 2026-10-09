'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useTranslations } from 'next-intl';
import { useAccount } from 'wagmi';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { BigUsd } from '@/components/ui-kit/BigUsd';
import { FundModal } from '@/components/wallet/FundModal';
import { formatSignedCompactUsd } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';
import { totalUsdc, useUsdcBalances } from '@/lib/use-usdc-balance';

/**
 * The home screen's balance (2026-10-09 app redesign): everything you own — USDC on every chain
 * plus your open positions at their current value — as one big number, with open-position PnL
 * under it and Deposit beside it. Signed out: a sign-in prompt in the same spot.
 */
export function PortfolioHeader() {
  const t = useTranslations('home');
  const { ready, authenticated, login } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  const [fundOpen, setFundOpen] = useState(false);

  if (ready && !authenticated) {
    return (
      <section className="flex items-center justify-between gap-3 px-1 py-4">
        <div>
          <p className="font-display text-2xl font-bold text-ink-900">{t('welcome')}</p>
          <p className="font-body text-sm text-ink-600">{t('welcomeSub')}</p>
        </div>
        <button type="button" onClick={() => login()} className="shrink-0 rounded-2xl bg-accent px-5 py-3 font-display text-sm font-bold text-black">
          {t('signIn')}
        </button>
      </section>
    );
  }

  const cash = totalUsdc([balances.base, balances.bnb, balances.solana]);
  const held = positions?.reduce((sum, p) => sum + (p.currentValueUsd ?? 0), 0) ?? 0;
  const openPnl = positions?.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0) ?? 0;
  const total = cash === null ? null : cash + held;

  return (
    <section className="flex items-start justify-between gap-3 px-1 py-4">
      <div className={cn('min-w-0', hidden && 'select-none blur-md')}>
        <BigUsd value={total} className="block font-display text-4xl font-bold tracking-tight text-ink-900" />
        <p className={cn('mt-1 font-mono text-xs', openPnl >= 0 ? 'text-up' : 'text-down')}>
          {positions && positions.length > 0 ? `${formatSignedCompactUsd(openPnl)} ${t('openPnl')}` : t('noPositions')}
        </p>
      </div>
      <button
        type="button"
        onClick={() => setFundOpen(true)}
        className="shrink-0 rounded-2xl bg-accent px-6 py-3 font-display text-sm font-bold text-black shadow-[0_0_24px_rgba(0,255,135,0.35)]"
      >
        {t('deposit')}
      </button>
      <FundModal open={fundOpen} onClose={() => setFundOpen(false)} />
    </section>
  );
}
