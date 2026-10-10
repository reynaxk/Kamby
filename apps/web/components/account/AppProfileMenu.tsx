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
      <section className="flex flex-col items-center px-4 pb-6 pt-10 text-center md:hidden">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-raised text-ink-400">
          <User className="h-9 w-9" aria-hidden />
        </span>
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
      <div className="flex items-center gap-3 px-4 pb-2 pt-6">
        {profile?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised text-ink-400">
            <User className="h-8 w-8" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold text-ink-900">{name}</p>
          <Link href="#profile" className="font-body text-sm font-semibold text-accent">
            {t('menu_editProfile')}
          </Link>
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
          <Eye className="h-5 w-5 text-ink-400" aria-hidden />
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
  return <div className="mx-4 mt-4 divide-y divide-white/5 overflow-hidden rounded-2xl bg-surface">{children}</div>;
}

function MenuLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-3.5 active:bg-white/5">
      <span className="text-ink-400 [&>svg]:h-5 [&>svg]:w-5" aria-hidden>
        {icon}
      </span>
      <span className="flex-1 font-body text-[0.95rem] text-ink-900">{label}</span>
      <ChevronRight className="h-4 w-4 text-ink-400" aria-hidden />
    </Link>
  );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-white/5">
      <span className={cn('[&>svg]:h-5 [&>svg]:w-5', danger ? 'text-down' : 'text-ink-400')} aria-hidden>
        {icon}
      </span>
      <span className={cn('flex-1 font-body text-[0.95rem]', danger ? 'text-down' : 'text-ink-900')}>{label}</span>
    </button>
  );
}
