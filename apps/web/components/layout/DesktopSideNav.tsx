'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';
import { KambyLogo } from './KambyLogo';
import { SearchBar } from '@/components/market/SearchBar';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { UsdcBalancePill } from '@/components/wallet/UsdcBalancePill';
import { WatchlistStrip } from './WatchlistStrip';
import { FEED_ENABLED } from '@/lib/feed-client';

type Item = { href: string; label: string; match: string[]; icon: React.ReactNode; soon?: boolean };

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
    { href: '/hunt', label: t('hunt'), match: ['/hunt'], icon: null },
    { href: '/explore', label: t('explore'), match: ['/explore', '/market', '/solana', '/search'], icon: null },
    { href: '/leaderboard/track', label: t('track'), match: ['/leaderboard/track'], icon: null },
    { href: '/account', label: t('portfolio'), match: ['/account', '/trades', '/notifications', '/referrals'], icon: null },
    { href: '/live', label: t('live'), match: ['/live'], icon: null },
    { href: '/launch', label: t('launchpad'), match: ['/launch'], icon: null },
  ];
  // Kamby Prime (2026-11-04): six sections in the row, the rest one click away under More.
  const more: Item[] = [
    ...(FEED_ENABLED ? [{ href: '/feed', label: t('feed'), match: ['/feed'], icon: null }] : []),
    { href: '/news', label: t('news'), match: ['/news'], icon: null },
    { href: '/narratives', label: t('narratives'), match: ['/narratives'], icon: null },
    { href: '/predictions', label: t('predictions'), match: ['/predictions'], icon: null },
    { href: '/leaderboard', label: t('leaders'), match: ['/leaderboard', '/trader', '/duels'], icon: null },
    // Perps is months away (owner 2026-11-02): shown, not clickable, with a "Soon" tag.
    { href: '/perps', label: t('perps'), match: ['/perps'], soon: true, icon: null },
  ];
  const isActive = (item: Item) => item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  const trackActive = isActive(items[2]!);
  const moreActive = !trackActive && more.some(isActive);

  return (
    <nav
      aria-label={t('menu')}
      className="kamby-void sticky top-0 z-50 hidden h-12 items-center gap-0.5 border-b border-line bg-bg/95 px-4 backdrop-blur-md lg:flex"
    >
      <Link href="/hunt" className="mr-4 flex shrink-0 items-center" aria-label="Kamby">
        <KambyLogo size="sm" />
      </Link>
      <ul className="flex min-w-0 flex-1 items-center gap-0.5">
        {items.map((item) => {
          const active = item.href === '/leaderboard/track' ? trackActive : isActive(item);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center rounded-lg px-3 text-[0.84rem] font-medium transition-colors',
                  active ? 'bg-surface-raised text-ink-900' : 'text-ink-600 hover:text-ink-900',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
        <li className="shrink-0">
          <MoreMenu label={t('more')} soonLabel={t('soon')} items={more} active={moreActive} isActive={isActive} />
        </li>
      </ul>
      <div className="ml-2 w-64 shrink-0 2xl:w-80">
        <SearchBar compact />
      </div>
      <div className="ml-2 flex shrink-0 items-center gap-2">
        <Link
          href="/messages"
          aria-label={tDm('title')}
          className={cn('relative flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-600 hover:text-ink-900', pathname.startsWith('/messages') && 'bg-surface-raised text-ink-900')}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-accent px-1 text-center font-mono text-[0.58rem] font-bold leading-4 text-accent-ink">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </Link>
        <UsdcBalancePill />
        <ConnectWalletButton enforceChain={false} />
      </div>
    </nav>
  );
}

/** Everything that isn't in the row: one small list, closes on a click outside or a pick. */
function MoreMenu({ label, soonLabel, items, active, isActive }: { label: string; soonLabel: string; items: Item[]; active: boolean; isActive: (item: Item) => boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-8 items-center gap-1 rounded-lg px-3 text-[0.84rem] font-medium transition-colors', active || open ? 'bg-surface-raised text-ink-900' : 'text-ink-600 hover:text-ink-900')}
      >
        {label}
        <svg viewBox="0 0 24 24" className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-52 rounded-xl border border-line bg-surface p-1 shadow-2xl shadow-black/60">
          {items.map((item) =>
            item.soon ? (
              <span key={item.href} aria-disabled="true" className="flex h-9 cursor-default items-center justify-between rounded-lg px-3 text-[0.84rem] text-ink-400">
                {item.label}
                <span className="rounded-md border border-line px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide">{soonLabel}</span>
              </span>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={cn('flex h-9 items-center rounded-lg px-3 text-[0.84rem]', isActive(item) ? 'bg-surface-raised text-ink-900' : 'text-ink-600 hover:bg-surface-raised hover:text-ink-900')}
              >
                {item.label}
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Moves the app right of DesktopSideNav on pages that show it. */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // --nav-w: how far fixed side panes (Messages' chat list) start from the left edge.
  // --top-h: how far fixed panes (Messages' chat list) start below the top menu.
  const shown = showsDesktopSideNav(pathname);
  return (
    <div className={shown ? 'kamby-app-frame lg:[--top-h:48px]' : undefined}>
      {/* Starred coins under the menu (2026-11-02); it scrolls away with the page. */}
      {shown && <WatchlistStrip />}
      {children}
    </div>
  );
}
