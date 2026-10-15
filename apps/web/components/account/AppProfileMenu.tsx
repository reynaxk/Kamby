'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { useTranslations } from 'next-intl';
import { Bell, ChevronRight, Copy, Eye, Gift, History, LogOut, Pencil, Star, User } from 'lucide-react';
import { cn } from '@kamby/ui';
import { fetchMyProfile, type MyProfile } from '@/lib/profile-client';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';
import { PROFILE_UPDATED_EVENT } from './ProfileMenu';
import { BlurBalancesToggle } from './BlurBalancesToggle';

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

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const load = () =>
      fetchMyProfile()
        .then((p) => !cancelled && setProfile(p))
        .catch(() => {});
    void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, load);
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
  return (
    <section className="md:hidden">
      {/* Your card, in the PnL cards' "midnight" look (2026-10-15): faint K, neon-ringed avatar. */}
      <div className="relative mx-4 mt-5 overflow-hidden rounded-3xl border border-white/10 p-5" style={{ background: 'linear-gradient(165deg,#141B4D 0%,#0A0E26 50%,#06070C 100%)' }}>
        <svg className="pointer-events-none absolute -right-10 -top-8" width="190" height="190" viewBox="0 0 512 512" aria-hidden="true">
          <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
            <path d="M186 140 V372" />
            <path d="M200 268 L338 140" />
            <path d="M232 246 L346 372" />
          </g>
        </svg>
        <div className="relative flex items-center gap-4">
          {profile?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-accent/70 ring-offset-2 ring-offset-[#0A0E26]" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.06] text-ink-400 ring-2 ring-accent/70 ring-offset-2 ring-offset-[#0A0E26]">
              <User className="h-8 w-8" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-2xl font-black tracking-tight text-white">{name}</p>
            <Link href="#profile" className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 font-body text-xs font-semibold text-white">
              <Pencil className="h-3 w-3" aria-hidden />
              {t('menu_editProfile')}
            </Link>
          </div>
        </div>
      </div>
      <MenuGroup>
        {address && <MenuLink href={`/trader/${address}`} icon={<User />} label={t('menu_publicProfile')} />}
        <MenuLink href="/trades" icon={<History />} label={t('menu_trades')} />
        <MenuLink href="/watchlist" icon={<Star />} label={t('menu_watchlist')} />
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
        {address && (
          <MenuButton
            icon={<Copy />}
            label={copied ? tU('copied_6d6d') : t('menu_copyAddress')}
            onClick={() => {
              void navigator.clipboard.writeText(address).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          />
        )}
        <MenuButton icon={<Pencil />} label={t('menu_editProfile')} onClick={() => document.getElementById('profile')?.scrollIntoView({ behavior: 'smooth' })} />
      </MenuGroup>
      <MenuGroup>
        <MenuButton icon={<LogOut />} label={t('menu_signOut')} danger onClick={() => void logout()} />
      </MenuGroup>
    </section>
  );
}

function MenuGroup({ children }: { children: ReactNode }) {
  return <div className="kamby-glass mx-4 mt-4 divide-y divide-white/5 overflow-hidden rounded-3xl bg-surface">{children}</div>;
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
