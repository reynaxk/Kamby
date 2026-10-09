'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@kamby/ui';
import { useTranslations } from 'next-intl';

const TABS = [
  { href: '/terminal', label: 'trade', match: ['/terminal', '/market', '/solana'], icon: TradeIcon },
  { href: '/watchlist', label: 'watchlist', match: ['/watchlist'], icon: StarIcon },
  { href: '/leaderboard', label: 'leaders', match: ['/leaderboard', '/trader'], icon: TrophyIcon },
  { href: '/account', label: 'profile', match: ['/account', '/trades', '/notifications', '/referrals'], icon: UserIcon },
] as const;

/**
 * Phone navigation (2026-10-09, "make it easier to interact in the app"): four tabs under the
 * thumb, like a native trading app — Trade, Watchlist, Leaders, Profile. Phones only (the
 * price ticker keeps the desktop bottom edge); hidden on the landing page.
 */
export function MobileTabBar() {
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  if (pathname === '/') return null;
  return (
    <nav
      aria-label="Main"
      className="kamby-void fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-16 grid-cols-4">
        {TABS.map((tab) => {
          const active = tab.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-full flex-col items-center justify-center gap-1 font-display text-[0.65rem] font-semibold transition-colors',
                  active ? 'text-accent' : 'text-ink-400 active:text-ink-900',
                )}
              >
                <Icon />
                {t(tab.label)}
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
function TradeIcon() {
  return svg(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>);
}
function StarIcon() {
  return svg(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />);
}
function TrophyIcon() {
  return svg(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></>);
}
function UserIcon() {
  return svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
}
