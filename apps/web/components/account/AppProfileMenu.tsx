'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { useTranslations } from 'next-intl';
import { Bell, ChevronRight, Copy, Eye, Gift, History, LogOut, Pencil, Star, User } from 'lucide-react';
import { cn } from '@kamby/ui';
import { fetchMyProfile, type MyProfile } from '@/lib/profile-client';
import { SESSION_CHANGED_EVENT } from '@/lib/session-client';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';
import { PROFILE_UPDATED_EVENT } from './ProfileMenu';
import { BlurBalancesToggle } from './BlurBalancesToggle';
import { SafeImg } from '@/components/social/SafeImg';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { useBalanceVisibility } from './BalanceVisibilityContext';
import { ProfileEditor } from './ProfileEditor';
import { BigUsd } from '@/components/ui-kit/BigUsd';
import { FundButton } from '@/components/wallet/FundButton';
import { SendButton } from '@/components/wallet/SendButton';
import { HomeHoldings } from '@/components/home/HomeHoldings';
import { PnlHistoryChart } from '@/components/discovery/PnlHistoryChart';
import { PnlCalendar } from './PnlCalendar';
import { PnlSummary } from './PnlSummary';
import { formatSignedCompactUsd } from '@/lib/format';
import { useMyPositions } from '@/lib/my-positions';
import { useUsdcBalances } from '@/lib/use-usdc-balance';

/**
 * The Profile tab as an app screen (2026-10-10). Phones have no site header any more, so
 * everything its profile menu held lives here: who you are, your lists, settings and sign
 * out — as a settings list, like a native app. Signed out, it's a sign-in screen instead.
 * Phones only; desktop keeps the header menu.
 */
export function AppProfileMenu() {
  const t = useTranslations('labels');
  const tAuth = useTranslations('auth');
  const tU = useTranslations('ui');
  const { ready, authenticated, login, logout } = usePrivy();
  const { address } = useAccount();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'holdings' | 'pnl' | 'settings'>('holdings');
  const tH = useTranslations('home');
  const tY = useTranslations('you');
  const { wallets } = useSolanaWallets();
  const balances = useUsdcBalances(address, wallets[0]?.address);
  const positions = useMyPositions();
  const { hidden } = useBalanceVisibility();

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const load = () =>
      fetchMyProfile()
        .then((p) => !cancelled && setProfile(p))
        .catch(() => {});
    void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    // The wallet signature can swap this browser onto the person's real account — show it.
    window.addEventListener(SESSION_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, load);
      window.removeEventListener(SESSION_CHANGED_EVENT, load);
    };
  }, [authenticated]);

  if (!ready) return <div className="h-40 md:hidden" aria-hidden />;

  if (!authenticated) {
    return (
      <section className="kamby-glass mx-4 mt-6 flex flex-col items-center rounded-3xl px-5 pb-6 pt-8 text-center md:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG */}
        <img src="/brand/kamby-mark.svg" alt="" className="h-20 w-20" />
        <h1 className="mt-4 font-display text-2xl font-bold text-ink-900">{t('profileWelcome')}</h1>
        <p className="mt-2 max-w-xs font-body text-sm text-ink-400">{t('profileWelcomeSub')}</p>
        <button
          type="button"
          onClick={() => login()}
          className="mt-6 h-14 w-full max-w-sm rounded-2xl bg-accent font-display text-base font-bold text-black active:scale-[0.98]"
        >
          {tAuth('signIn')}
        </button>
        <div className="mt-8 w-full max-w-sm">
          <LanguageSelect />
        </div>
      </section>
    );
  }

  const name = profile?.username ? `@${profile.username}` : tU('yourAccount_f2fc');
  const cash = balances.total;
  const held = positions?.reduce((sum, p) => sum + (p.currentValueUsd ?? 0), 0) ?? 0;
  const openPnl = positions?.reduce((sum, p) => sum + (p.unrealizedPnlUsd ?? 0), 0) ?? 0;
  const total = cash === null ? null : cash + held;
  const copyAddress = () => {
    if (!address) return;
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const editProfile = () => {
    setTab('settings');
    setTimeout(() => document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  // The Profile tab as GMGN's "You" (2026-10-28, owner: "like GMGN but better, simpler"): who you
  // are and your money first, then Holdings / PnL / Settings — instead of a long stack of cards.
  return (
    <section className="px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:hidden">
      <div className="flex items-center gap-3">
        <SafeImg
          src={profile?.avatarUrl}
          className="h-12 w-12 rounded-full object-cover ring-2 ring-accent/60 ring-offset-2 ring-offset-bg"
          fallback={
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] text-ink-400 ring-2 ring-accent/60 ring-offset-2 ring-offset-bg">
              <User className="h-6 w-6" aria-hidden />
            </span>
          }
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-black tracking-tight text-ink-900">{name}</p>
          {address && (
            <button type="button" onClick={copyAddress} className="mt-0.5 flex items-center gap-1 font-mono text-xs text-ink-400 active:text-ink-900">
              {copied ? tU('copied_6d6d') : `${address.slice(0, 6)}…${address.slice(-4)}`}
              <Copy className="h-3 w-3" aria-hidden />
            </button>
          )}
        </div>
        <button type="button" onClick={editProfile} aria-label={t('menu_editProfile')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-ink-600 active:bg-white/[0.12]">
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        {address && (
          <Link href={`/trader/${address}`} aria-label={t('menu_publicProfile')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-ink-600 active:bg-white/[0.12]">
            <ChevronRight className="h-5 w-5" aria-hidden />
          </Link>
        )}
      </div>

      <p className="mt-6 font-body text-xs font-semibold text-ink-400">{tH('totalBalance')}</p>
      <div className={cn('mt-0.5', hidden && 'select-none blur-md')}>
        <BigUsd value={total} className="block font-display text-[2.6rem] font-bold leading-none tracking-tight text-ink-900" />
        <p className={cn('mt-1.5 font-body text-sm font-semibold tabular-nums', !positions?.length ? 'text-ink-400' : openPnl >= 0 ? 'text-up' : 'text-down')}>
          {positions && positions.length > 0 ? `${formatSignedCompactUsd(openPnl)} ${tH('openPnl')}` : total === 0 ? tH('fundHint') : tH('noPositions')}
        </p>
      </div>
      <div className="mt-4 flex gap-2">
        <FundButton variant="pill" />
        <SendButton variant="pill" />
        <SendButton variant="pill" toUser />
      </div>

      <div role="tablist" className="mt-6 flex gap-6 border-b border-white/[0.07]">
        {(['holdings', 'pnl', 'settings'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn('relative pb-2.5 font-display text-[0.95rem] font-bold transition-colors', tab === id ? 'text-ink-900' : 'text-ink-400')}
          >
            {tY(id)}
            {tab === id && <span aria-hidden className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === 'holdings' && (
        <div className="pt-1">
          <HomeHoldings bare emptyText={tY('noHoldings')} />
          <MenuGroup>
            <MenuLink href="/trades" icon={<History />} label={t('menu_trades')} />
            <MenuLink href="/watchlist" icon={<Star />} label={t('menu_watchlist')} />
          </MenuGroup>
        </div>
      )}
      {tab === 'pnl' && (
        <div className="space-y-5 pt-4">
          {address && <PnlSummary address={address} openPnl={openPnl} />}
          <PnlCalendar />
          <PnlHistoryChart />
        </div>
      )}
      {tab === 'settings' && (
        <div className="pb-4">
          <MenuGroup>
            <MenuLink href="/notifications" icon={<Bell />} label={t('menu_notifications')} />
            <MenuLink href="/referrals" icon={<Gift />} label={t('menu_referrals')} />
          </MenuGroup>
          <MenuGroup>
            <div className="flex items-center gap-3 px-4 py-3">
              <IconTile>
                <Eye />
              </IconTile>
              <span className="flex-1 font-body text-[0.95rem] text-ink-900">{t('menu_hideBalances')}</span>
              <BlurBalancesToggle />
            </div>
            <div className="px-4 py-2">
              <LanguageSelect />
            </div>
          </MenuGroup>
          <div id="profile" className="mt-4 scroll-mt-6">
            <ProfileEditor />
          </div>
          <MenuGroup>
            <MenuButton icon={<LogOut />} label={t('menu_signOut')} danger onClick={() => void logout()} />
          </MenuGroup>
        </div>
      )}
    </section>
  );
}

function MenuGroup({ children }: { children: ReactNode }) {
  return <div className="kamby-glass mt-4 divide-y divide-white/5 overflow-hidden rounded-3xl bg-surface">{children}</div>;
}

function MenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3 active:bg-white/5">
      <IconTile>{icon}</IconTile>
      <span className="flex-1 font-body text-[0.95rem] text-ink-900">{label}</span>
      <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
    </Link>
  );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5">
      <IconTile danger={danger}>{icon}</IconTile>
      <span className={cn('flex-1 font-body text-[0.95rem]', danger ? 'text-down' : 'text-ink-900')}>{label}</span>
    </button>
  );
}

/** A menu row's icon in its own small tile (2026-10-15), neon — red for signing out. */
function IconTile({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <span aria-hidden className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]', danger ? 'bg-down/10 text-down' : 'bg-accent/[0.08] text-accent')}>
      {children}
    </span>
  );
}
