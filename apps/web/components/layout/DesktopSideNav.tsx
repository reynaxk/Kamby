'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';
import { KambyLogo } from './KambyLogo';
import { SideNavLive } from './SideNavLive';
import { FEED_ENABLED } from '@/lib/feed-client';

type Item = { href: string; label: string; match: string[]; icon: React.ReactNode; badge?: 'unread' };

/** Pages that keep the whole width: the landing page, the legal pages and invite links. */
export function showsDesktopSideNav(pathname: string): boolean {
  if (pathname === '/') return false;
  return !['/privacy', '/terms', '/risk', '/c/'].some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/**
 * The desktop app's left menu (2026-10-30 redesign, owner's concepts): every part of Kamby one
 * click away — Home, Trade, Live, Chat, Top Traders, Perps, LaunchPad, Watchlist, Profile — from
 * lg up. Phones keep MobileTabBar. AppFrame moves the page right by the menu's width.
 */
export function DesktopSideNav() {
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  const tDm = useTranslations('dm');
  const unread = useDmUnread();
  const unreadCount = (unread?.messages ?? 0) + (unread?.requests ?? 0);
  if (!showsDesktopSideNav(pathname)) return null;

  const items: Item[] = [
    { href: '/home', label: t('home'), match: ['/home'], icon: <path d="M3 10.5 12 3l9 7.5M5 9.5V20h14V9.5" /> },
    ...(FEED_ENABLED ? [{ href: '/feed', label: t('feed'), match: ['/feed'], icon: <path d="M4 6h16M4 12h16M4 18h10" /> }] : []),
    { href: '/terminal', label: t('trade'), match: ['/terminal', '/market', '/solana', '/search'], icon: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></> },
    { href: '/news', label: t('news'), match: ['/news'], icon: <><path d="M4 5h13v14H6a2 2 0 0 1-2-2z" /><path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" /></> },
    { href: '/live', label: t('live'), match: ['/live'], icon: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></> },
    { href: '/messages', label: tDm('title'), match: ['/messages'], badge: 'unread', icon: <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" /> },
    { href: '/leaderboard', label: t('leaders'), match: ['/leaderboard', '/trader', '/duels'], icon: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></> },
    { href: '/perps', label: t('perps'), match: ['/perps'], icon: <path d="M13 2 4 14h7l-1 8 9-12h-7z" /> },
    { href: '/launch', label: t('launchpad'), match: ['/launch'], icon: <><path d="M5 19c2-6 6-10 14-14-1 8-5 12-11 14" /><path d="m5 19 4-4" /></> },
    { href: '/watchlist', label: t('watchlist'), match: ['/watchlist'], icon: <path d="m12 3 2.7 6 6.3.6-4.8 4.2 1.4 6.2L12 17l-5.6 3 1.4-6.2L3 9.6 9.3 9z" /> },
    { href: '/account', label: t('profile'), match: ['/account', '/trades', '/notifications', '/referrals'], icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></> },
  ];

  return (
    <nav
      aria-label={t('menu')}
      className="kamby-void fixed bottom-[var(--ticker-h)] left-0 top-0 z-40 hidden w-[232px] flex-col border-r border-line bg-bg px-3.5 pb-4 pt-5 lg:flex"
    >
      <Link href="/home" className="mb-6 flex items-center gap-2 px-2.5">
        <KambyLogo />
      </Link>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 font-display text-sm font-bold transition-colors',
                  active ? 'bg-accent/[0.07] text-ink-900 ring-1 ring-inset ring-accent/15' : 'text-ink-600 hover:bg-surface hover:text-ink-900',
                )}
              >
                <svg
                  width="19"
                  height="19"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={active ? 'text-accent' : undefined}
                  aria-hidden
                >
                  {item.icon}
                </svg>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge === 'unread' && unreadCount > 0 && (
                  <span className="min-w-5 rounded-full bg-accent px-1.5 py-px text-center font-mono text-[0.65rem] font-bold text-black">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="min-h-0 overflow-y-auto [scrollbar-width:none]">
        <SideNavLive />
      </div>
      <p className="mt-auto px-3 pt-3 font-mono text-[0.6rem] tracking-[0.2em] text-accent/70">FIND.TRADE.REPEAT</p>
    </nav>
  );
}

/** Moves the app right of DesktopSideNav on pages that show it. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // --nav-w: how far fixed side panes (Messages' chat list) start from the left edge.
  return <div className={showsDesktopSideNav(pathname) ? 'lg:pl-[232px] lg:[--nav-w:232px]' : undefined}>{children}</div>;
}
