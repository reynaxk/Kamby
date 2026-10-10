'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { usePrivy } from '@privy-io/react-auth';

const TABS = [
  { href: '/home', label: 'home', match: ['/home'], icon: HomeIcon },
  { href: '/search', label: 'search', match: ['/search'], icon: SearchIcon },
  { href: '/terminal', label: 'trade', match: ['/terminal', '/market', '/solana'], icon: TradeIcon, center: true },
  { href: '/leaderboard', label: 'leaders', match: ['/leaderboard', '/trader'], icon: TrophyIcon },
  { href: '/account', label: 'profile', match: ['/account', '/trades', '/notifications', '/referrals', '/watchlist'], icon: UserIcon },
] as const;

/**
 * Phone navigation (2026-10-09 app redesign): a floating glass pill under the thumb — Home,
 * Search, Trade (centre), Leaders, Profile — icons only, the active one lit. Phones only (the
 * price ticker keeps the desktop bottom edge); hidden on the landing page.
 */
export function MobileTabBar() {
  const tU = useTranslations('ui');
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  const { ready, authenticated, login } = usePrivy();
  // The landing page has none; a coin's screen has its own Buy/Sell bar there instead (like fomo).
  if (pathname === '/' || pathname.startsWith('/solana') || pathname.startsWith('/market/')) return null;
  return (
    <nav aria-label={tU('main_a02c')} className="fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 md:hidden">
      <ul className="kamby-void flex h-14 items-center justify-around rounded-full border border-white/10 bg-surface/80 px-2 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-xl">
        {TABS.map((tab) => {
          const active = tab.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-label={t(tab.label)}
                aria-current={active ? 'page' : undefined}
                onClick={(e) => {
                  // The terminal is for signed-in traders — signed out, Trade opens sign-in.
                  if (tab.href === '/terminal' && ready && !authenticated) {
                    e.preventDefault();
                    login();
                  }
                }}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-full transition-all active:scale-90',
                  'center' in tab && tab.center
                    ? active
                      ? 'bg-accent text-black shadow-[0_0_20px_rgba(0,255,135,0.5)]'
                      : 'bg-accent/15 text-accent'
                    : active
                      ? 'bg-white/10 text-ink-900'
                      : 'text-ink-400',
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
function TradeIcon() {
  return svg(<><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>);
}
function TrophyIcon() {
  return svg(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></>);
}
function UserIcon() {
  return svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
}
