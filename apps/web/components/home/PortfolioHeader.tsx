'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useTranslations } from 'next-intl';
import { AppBell } from '@/components/notifications/AppBell';
import { markAppReady } from '@/components/pwa/AppSplash';
import { useAccount } from 'wagmi';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { BigUsd } from '@/components/ui-kit/BigUsd';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';
import { formatSignedCompactUsd } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';
import { totalUsdc, useUsdcBalances } from '@/lib/use-usdc-balance';

/**
 * The home screen's balance (2026-10-09 app redesign): everything you own — USDC on every chain
 * plus your open positions at their current value — as one big number, with open-position PnL
 * under it and Deposit beside it. Signed out: a sign-in prompt in the same spot.
 */
export function PortfolioHeader() {
  const tLp = useTranslations('launchpad');
  const t = useTranslations('home');
  const { ready, authenticated, login } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();

  // The launch splash waits for this: signed out, or the balance is in (2026-10-11).
  const cashReady = totalUsdc([balances.base, balances.bnb, balances.solana]) !== null;
  useEffect(() => {
    if (ready && (!authenticated || cashReady)) markAppReady();
  }, [ready, authenticated, cashReady]);

  if (ready && !authenticated) {
    return (
      <>
      <ScrolledBar />
      <section className="kamby-rise kamby-glass mt-2 flex items-center justify-between gap-3 rounded-3xl px-4 py-4 md:px-1">
        <div>
          <p className="font-display text-2xl font-bold text-ink-900">{t('welcome')}</p>
          <p className="font-body text-sm text-ink-600">{t('welcomeSub')}</p>
        </div>
        <button type="button" onClick={() => login()} className="shrink-0 rounded-2xl bg-accent px-5 py-3 font-display text-sm font-bold text-black">
          {t('signIn')}
        </button>
      </section>
      </>
    );
  }

  const cash = totalUsdc([balances.base, balances.bnb, balances.solana]);
  const held = positions?.reduce((sum, p) => sum + (p.currentValueUsd ?? 0), 0) ?? 0;
  const openPnl = positions?.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0) ?? 0;
  const total = cash === null ? null : cash + held;

  return (
    <>
    <ScrolledBar>
      <BigUsd value={total} className={cn('font-display text-base font-bold text-ink-900', hidden && 'select-none blur-sm')} />
    </ScrolledBar>
    {/* Phones: the logo and the bell above the balance — the app's own top row. */}
    <div className="kamby-rise -mb-2 flex items-center justify-between pt-1 md:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG */}
      <img src="/brand/kamby-mark.svg" alt="Kamby" className="h-7 w-7" />
      <AppBell />
    </div>
    <section className="kamby-rise kamby-rise-2 kamby-glass relative mt-3 overflow-hidden rounded-3xl px-4 py-4 md:px-1">
      {/* The faint neon K of the PnL cards (2026-10-15), Kamby's mark on its own balance. */}
      <svg className="pointer-events-none absolute -right-5 -top-5 md:hidden" width="150" height="150" viewBox="0 0 512 512" aria-hidden="true">
        <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" opacity="0.06">
          <path d="M186 140 V372" />
          <path d="M200 268 L338 140" />
          <path d="M232 246 L346 372" />
        </g>
      </svg>
      <div className={cn('relative min-w-0', hidden && 'select-none blur-md')}>
        <BigUsd value={total} className="block font-display text-4xl font-bold tracking-tight text-ink-900" />
        <p className={cn('mt-1 font-mono text-xs', openPnl >= 0 ? 'text-up' : 'text-down')}>
          {positions && positions.length > 0 ? `${formatSignedCompactUsd(openPnl)} ${t('openPnl')}` : t('noPositions')}
        </p>
      </div>
      {/* Deposit + Withdraw side by side, like a wallet app's quick actions. */}
      <div className="relative mt-4 grid grid-cols-3 gap-2 md:flex">
        <FundButton variant="stacked" />
        <SendButton variant="stacked" />
        {/* Send to another Kamby user by their @name (2026-10-15). */}
        <SendButton variant="stacked" toUser />
      </div>
      {/* Kamby's LaunchPad (2026-10-14). */}
      <Link href="/launch" className="relative mt-2 flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3 transition-colors active:bg-white/[0.08]">
        <span>
          <span className="block font-display text-sm font-bold text-ink-900">Kamby&apos;s LaunchPad</span>
          <span className="block font-body text-xs text-ink-400">{tLp('homeCard')}</span>
        </span>
        <span className="font-display text-lg font-bold text-accent" aria-hidden>
          →
        </span>
      </Link>
    </section>
    </>
  );
}

/**
 * Phones (2026-10-10, like fomo): once the big balance scrolls away, a slim bar at the top keeps
 * the logo and a small balance in view, over the sticky list tabs.
 */
function ScrolledBar({ children }: { children?: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 80);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div
      aria-hidden={!shown}
      className={cn(
        // Solid, not see-through: the coin list scrolling under it showed through as ghost text.
        'fixed inset-x-0 top-0 z-40 flex h-[calc(env(safe-area-inset-top)+3rem)] items-end justify-center border-b border-white/[0.04] bg-[#06070C] pb-2.5 transition-opacity duration-200 md:hidden',
        shown ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG */}
      <img src="/brand/kamby-mark.svg" alt="" className="absolute bottom-2.5 left-4 h-6 w-6" />
      {children}
    </div>
  );
}
