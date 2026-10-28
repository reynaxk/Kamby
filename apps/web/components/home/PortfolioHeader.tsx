'use client';

import Link from 'next/link';

import { useEffect, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useTranslations } from 'next-intl';
import { AppBell } from '@/components/notifications/AppBell';
import { StoriesRow } from '@/components/stories/Stories';
import { GoLiveSheet } from '@/components/live/GoLive';
import { markAppReady } from '@/components/pwa/AppSplash';
import { useAccount } from 'wagmi';
import { cn } from '@kamby/ui';
import { useBalanceVisibility } from '@/components/account/BalanceVisibilityContext';
import { BigUsd } from '@/components/ui-kit/BigUsd';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';
import { formatSignedCompactUsd } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';
import { useUsdcBalances } from '@/lib/use-usdc-balance';

/**
 * The home screen's balance (2026-10-09 app redesign): everything you own — USDC on every chain
 * plus your open positions at their current value — as one big number, with open-position PnL
 * under it and Deposit beside it. Signed out: a sign-in prompt in the same spot.
 */
export function PortfolioHeader() {
  const tP = useTranslations('perps');
  const t = useTranslations('home');
  const { ready, authenticated, login } = usePrivy();
  const { address } = useAccount();
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();
  const tS = useTranslations('stories');
  const [goLive, setGoLive] = useState(false);

  // The launch splash waits for this: signed out, or the balance is in (2026-10-11).
  const cashReady = balances.total !== null;
  useEffect(() => {
    if (ready && (!authenticated || cashReady)) markAppReady();
  }, [ready, authenticated, cashReady]);

  if (ready && !authenticated) {
    return (
      <>
      <ScrolledBar />
      <section className="kamby-rise kamby-glass mt-2 flex items-center justify-between gap-3 rounded-3xl px-4 py-4 md:mt-6 md:border md:border-white/[0.07] md:bg-gradient-to-br md:from-[#0E1430] md:via-[#090C1A] md:to-[#05070A] md:px-7 md:py-6">
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

  // The same one total the header shows — Robinhood's USDG included (2026-10-18).
  const cash = balances.total;
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
    {/* Today's wins as stories, Instagram-style (2026-10-17). */}
    <StoriesRow />
    {/* The balance, flat and short (2026-10-28, owner: "like GMGN but better, simpler"): one big
        number, the money buttons as one row of pills, LaunchPad and Perps as two slim links — so
        the coins start higher on the screen. No card, no glow. */}
    <section className="kamby-rise kamby-rise-2 relative mt-4 md:mt-6">
      <p className="font-body text-xs font-semibold text-ink-400">{t('totalBalance')}</p>
      <div className={cn('mt-0.5 min-w-0', hidden && 'select-none blur-md')}>
        <BigUsd value={total} className="block font-display text-[2.6rem] font-bold leading-none tracking-tight text-ink-900" />
        <p className={cn('mt-1.5 font-body text-sm font-semibold tabular-nums', !positions?.length ? 'text-ink-400' : openPnl >= 0 ? 'text-up' : 'text-down')}>
          {positions && positions.length > 0 ? `${formatSignedCompactUsd(openPnl)} ${t('openPnl')}` : total === 0 ? t('fundHint') : t('noPositions')}
        </p>
      </div>
      <div className="mt-4 flex gap-2">
        <FundButton variant="pill" />
        <SendButton variant="pill" />
        {/* Send to another Kamby user by their @name (2026-10-15). */}
        <SendButton variant="pill" toUser />
        <button
          type="button"
          onClick={() => setGoLive(true)}
          aria-label={tS('goLive')}
          title={tS('goLive')}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FF3B69]/[0.12] text-[#FF5C83] transition-transform active:scale-[0.97]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="2.5" />
            <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" />
          </svg>
        </button>
      </div>
      {/* Kamby's LaunchPad (2026-10-14) and ⚡ Perps (2026-10-21), side by side. */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Link href="/launch" className="flex h-11 items-center justify-between gap-2 rounded-2xl border border-white/[0.06] px-3.5 transition-colors active:bg-white/[0.06] md:hover:bg-white/[0.04]">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-display text-sm font-bold text-ink-900">🚀 LaunchPad</span>
            <span className="truncate font-body text-xs text-ink-400">{tP('launchShort')}</span>
          </span>
          <span className="shrink-0 font-display text-base font-bold text-accent" aria-hidden>
            →
          </span>
        </Link>
        <Link href="/perps" className="flex h-11 items-center justify-between gap-2 rounded-2xl border border-white/[0.06] px-3.5 transition-colors active:bg-white/[0.06] md:hover:bg-white/[0.04]">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 font-display text-sm font-bold text-ink-900">⚡ {tP('card')}</span>
            <span className="truncate font-body text-xs text-ink-400">{tP('cardSub')}</span>
          </span>
          <span className="shrink-0 font-display text-base font-bold text-accent" aria-hidden>
            →
          </span>
        </Link>
      </div>
    </section>
    <GoLiveSheet open={goLive} onClose={() => setGoLive(false)} />
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
