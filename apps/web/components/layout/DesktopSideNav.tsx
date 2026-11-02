'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';
import { KambyLogo } from './KambyLogo';
import { SearchBar } from '@/components/market/SearchBar';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { UsdcBalancePill } from '@/components/wallet/UsdcBalancePill';
import { FEED_ENABLED } from '@/lib/feed-client';

type Item = { href: string; label: string; match: string[]; icon: React.ReactNode; badge?: 'unread'; soon?: boolean };

const NAV_KEY = 'kamby:nav';
/** Before first paint: a menu the user folded stays folded (no jump on load). */
export const NAV_GATE_SCRIPT = `try{if(localStorage.getItem('${NAV_KEY}')==='mini')document.documentElement.dataset.nav='mini'}catch(e){}`;

function toggleNav(): void {
  const mini = document.documentElement.dataset.nav !== 'mini';
  if (mini) document.documentElement.dataset.nav = 'mini';
  else delete document.documentElement.dataset.nav;
  try {
    localStorage.setItem(NAV_KEY, mini ? 'mini' : 'full');
  } catch {
    // private mode — still folds for this visit
  }
}

/** Pages that keep the whole width: the landing page, the legal pages and invite links. */
export function showsDesktopSideNav(pathname: string): boolean {
  if (pathname === '/') return false;
  return !['/privacy', '/terms', '/risk', '/c/'].some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/**
 * The desktop app's menu: every part of Kamby one click away from lg up. 2026-10-30 a left
 * column; 2026-11-01 one row across the top, like GMGN. Phones keep MobileTabBar.
 */
export function DesktopSideNav() {
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  const tDm = useTranslations('dm');
  const unread = useDmUnread();
  const unreadCount = (unread?.messages ?? 0) + (unread?.requests ?? 0);
  if (!showsDesktopSideNav(pathname)) return null;

  const items: Item[] = [
    // Trenches and Trending replaced Home and Trade (2026-11-01, owner: "like GMGN").
    { href: '/hunt', label: t('hunt'), match: ['/hunt'], icon: <path d="M12 3c.6 3.8 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1.1-3.8 2.2-4.9.3 1.8 1.3 2.9 2.4 3.1C11.3 9.4 11.4 6 12 3Z" /> },
    { href: '/explore', label: t('explore'), match: ['/explore', '/market', '/solana', '/search'], icon: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></> },
    ...(FEED_ENABLED ? [{ href: '/feed', label: t('feed'), match: ['/feed'], icon: <path d="M4 6h16M4 12h16M4 18h10" /> }] : []),
    { href: '/news', label: t('news'), match: ['/news'], icon: <><path d="M4 5h13v14H6a2 2 0 0 1-2-2z" /><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" /></> },
    { href: '/narratives', label: t('narratives'), match: ['/narratives'], icon: <path d="M12 3c.6 3.8 5 6 5 11a5 5 0 0 1-10 0c0-2.2 1.1-3.8 2.2-4.9.3 1.8 1.3 2.9 2.4 3.1C11.3 9.4 11.4 6 12 3Z" /> },
    { href: '/predictions', label: t('predictions'), match: ['/predictions'], icon: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></> },
    { href: '/live', label: t('live'), match: ['/live'], icon: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></> },
    { href: '/messages', label: tDm('title'), match: ['/messages'], badge: 'unread', icon: <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" /> },
    { href: '/leaderboard', label: t('leaders'), match: ['/leaderboard', '/trader', '/duels'], icon: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></> },
    // Perps is months away (owner 2026-11-02): shown, not clickable, with a "Soon" tag.
    { href: '/perps', label: t('perps'), match: ['/perps'], soon: true, icon: <path d="M13 2 4 14h7l-1 8 9-12h-7z" /> },
    { href: '/launch', label: t('launchpad'), match: ['/launch'], icon: <><path d="M5 19c2-6 6-10 14-14-1 8-5 12-11 14" /><path d="m5 19 4-4" /></> },
    { href: '/account', label: t('profile'), match: ['/account', '/trades', '/notifications', '/referrals'], icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  ];

  // One row across the top, like GMGN (owner 2026-11-01): logo, every section as a word,
  // then search, balance and your account. It replaced the left menu.
  return (
    <nav
      aria-label={t('menu')}
      className="kamby-void sticky top-0 z-50 hidden h-14 items-center gap-1 border-b border-line bg-bg/95 px-4 lg:flex"
    >
      <Link href="/hunt" className="mr-3 flex shrink-0 items-center" aria-label="Kamby">
        <KambyLogo size="sm" />
      </Link>
      <ul className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {items.filter((item) => item.href !== '/account').map((item) => {
          const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          if (item.soon) {
            return (
              <li key={item.href} className="shrink-0">
                <span aria-disabled="true" className="flex h-9 cursor-default items-center gap-1.5 px-2.5 font-display text-[0.86rem] font-bold text-ink-400">
                  {item.label}
                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-body text-[0.6rem] font-semibold uppercase tracking-wide text-ink-400">{t('soon')}</span>
                </span>
              </li>
            );
          }
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-9 items-center gap-1.5 rounded-lg px-2.5 font-display text-[0.86rem] font-bold transition-colors',
                  active ? 'text-accent' : 'text-ink-600 hover:bg-surface hover:text-ink-900',
                )}
              >
                {item.label}
                {item.badge === 'unread' && unreadCount > 0 && (
                  <span className="min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[0.6rem] font-bold text-black">{unreadCount > 9 ? '9+' : unreadCount}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="ml-2 w-44 shrink-0 2xl:w-52">
        <SearchBar compact />
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2">
        <UsdcBalancePill />
        <ConnectWalletButton enforceChain={false} />
      </div>
    </nav>
  );
}

/** Moves the app right of DesktopSideNav on pages that show it. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // --nav-w: how far fixed side panes (Messages' chat list) start from the left edge.
  // --top-h: how far fixed panes (Messages' chat list) start below the top menu.
  return <div className={showsDesktopSideNav(pathname) ? 'kamby-app-frame lg:[--top-h:56px]' : undefined}>{children}</div>;
}
