'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useDmUnread } from '@/lib/dm-client';

const TABS = [
  { href: '/home', label: 'home', match: ['/home'], icon: HomeIcon },
  { href: '/search', label: 'search', match: ['/search'], icon: SearchIcon },
  // Private messages, Instagram-style, one tap away (2026-10-17).
  { href: '/messages', label: 'messages', match: ['/messages'], icon: ChatIcon },
  { href: '/leaderboard', label: 'leaders', match: ['/leaderboard', '/trader'], icon: TrophyIcon },
  { href: '/account', label: 'profile', match: ['/account', '/trades', '/notifications', '/referrals', '/watchlist'], icon: UserIcon },
] as const;

/**
 * Phone navigation (2026-10-09 app redesign): a floating glass pill under the thumb — Home,
 * Search, Messages, Leaders, Profile — the active one a neon capsule with its name, the rest icons (the
 * centre Trade button was removed 2026-10-12: confusing). Phones only (the
 * price ticker keeps the desktop bottom edge); hidden on the landing page.
 */
export function MobileTabBar() {
  const tU = useTranslations('ui');
  const pathname = usePathname() ?? '/';
  const t = useTranslations('nav');
  const tDm = useTranslations('dm');
  const unread = useDmUnread();
  const unreadCount = (unread?.messages ?? 0) + (unread?.requests ?? 0);
  const label = (key: string) => (key === 'messages' ? tDm('title') : t(key));
  // The landing page has none; a coin's screen has its own Buy/Sell bar there instead (like fomo).
  // A private chat has its own composer at the bottom (2026-10-17).
  if (pathname === '/' || pathname.startsWith('/solana') || pathname.startsWith('/market/') || pathname.startsWith('/messages/') || pathname.startsWith('/live/')) return null;
  return (
    <nav aria-label={tU('main_a02c')} className="kamby-tabbar-in fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-50 md:hidden">
      <ul className="kamby-void flex h-14 items-center justify-around kamby-glass-solid kamby-glass-dense rounded-full px-2 shadow-[0_8px_32px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.07)]">
        {TABS.map((tab) => {
          const active = tab.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-label={label(tab.label)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  // The active tab is a solid neon capsule with its name; the rest are icons
                  // (2026-10-12, owner: the bar looked boring). Flat — no glow.
                  'relative flex h-11 min-w-11 items-center justify-center rounded-full transition-[background-color,color,padding] duration-300 ease-out active:scale-95',
                  active ? 'bg-accent pl-3.5 pr-4 text-black' : 'px-2.5 text-ink-400',
                )}
              >
                <Icon active={active} />
                {tab.label === 'messages' && unreadCount > 0 && !active && (
                  <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-body text-[0.58rem] font-bold text-black ring-2 ring-[#0A0C14]">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
                <span
                  className={cn(
                    'overflow-hidden whitespace-nowrap font-display text-sm font-bold transition-[max-width,opacity,margin] duration-300 ease-out',
                    active ? 'ml-2 max-w-[7rem] opacity-100' : 'ml-0 max-w-0 opacity-0',
                  )}
                  aria-hidden
                >
                  {label(tab.label)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function svg(children: React.ReactNode, active = false) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function HomeIcon({ active = false }: { active?: boolean }) {
  return svg(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>, active);
}
function SearchIcon({ active = false }: { active?: boolean }) {
  return svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>, active);
}
function TrophyIcon({ active = false }: { active?: boolean }) {
  return svg(<><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3a3 3 0 0 1-3 4M7 5H4a3 3 0 0 0 3 4" /></>, active);
}
function ChatIcon({ active = false }: { active?: boolean }) {
  return svg(<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />, active);
}
function UserIcon({ active = false }: { active?: boolean }) {
  return svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>, active);
}
