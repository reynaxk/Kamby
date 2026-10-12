'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';

const TABS = [
  { href: '/home', label: 'home', match: ['/home'], icon: HomeIcon },
  { href: '/search', label: 'search', match: ['/search'], icon: SearchIcon },
  { href: '/leaderboard', label: 'leaders', match: ['/leaderboard', '/trader'], icon: TrophyIcon },
  { href: '/account', label: 'profile', match: ['/account', '/trades', '/notifications', '/referrals', '/watchlist'], icon: UserIcon },
] as const;

/**
 * Phone navigation (2026-10-09 app redesign): a floating glass pill under the thumb — Home,
 * Search, Leaders, Profile — icons only (the centre Trade button was removed 2026-10-12: confusing), the active one lit. Phones only (the
 * price ticker keeps the desktop bottom edge); hidden on the landing page.
 */
export function MobileTabBar() {
  const tU = useTranslations('ui');
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  // The landing page has none; a coin's screen has its own Buy/Sell bar there instead (like fomo).
  if (pathname === '/' || pathname.startsWith('/solana') || pathname.startsWith('/market/')) return null;
  return (
    <nav aria-label={tU('main_a02c')} className="kamby-tabbar-in fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 md:hidden">
      <ul className="kamby-void flex h-14 items-center justify-around kamby-glass-solid rounded-full px-2 shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.07)]">
        {TABS.map((tab) => {
          const active = tab.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-label={t(tab.label)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-90',
                  active ? 'bg-accent/10 text-accent' : 'text-ink-400',
                )}
              >
                <Icon />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function svg(children: React.ReactNode) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function HomeIcon() {
  return svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>);
}
function SearchIcon() {
  return svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
}
function TrophyIcon() {
  return svg(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></>);
}
function UserIcon() {
  return svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
}
