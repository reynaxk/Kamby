'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@kamby/ui';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { SearchBar } from './SearchBar';

const NAV_LINKS = [
  { href: '/', label: 'Discover' },
  { href: '/trades', label: 'Trades' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/referrals', label: 'Referrals' },
] as const;

/**
 * "Discover" is the one top-level nav destination — trader profiles (`/trader/[address]`)
 * are real as of Phase 2, but reached from activity/search/follows rather than a top-level
 * link, since there's no trader *listing* page to point a nav item at yet. "Trades" (Phase 3),
 * "Watchlist" (Phase 6), and "Referrals" (Phase 7) are the exceptions: each is every user's
 * own private state, worth a permanent link even with no public listing page behind it.
 *
 * A Client Component (rather than composing a small nav-only client island) purely so
 * `usePathname()` can highlight whichever of the three links is actually current — every
 * child here (`SearchBar` aside) was already a Client Component anyway (wagmi/wallet
 * state), so this isn't giving up meaningful server rendering.
 */
export function MarketHeader({ searchValue }: { searchValue?: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span aria-hidden className="text-xl">
            🔥
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight text-ink-900">
            Kamby
          </span>
        </Link>
        {NAV_LINKS.map((link) => {
          const isActive = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return isActive ? (
            <span
              key={link.href}
              className="rounded-full bg-accent/10 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wide text-accent"
            >
              {link.label}
            </span>
          ) : (
            <Link
              key={link.href}
              href={link.href}
              className={cn('font-mono text-[0.7rem] uppercase tracking-wide text-ink-400 hover:text-ink-900')}
            >
              {link.label}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-3">
          <SearchBar defaultValue={searchValue} />
          <NotificationBell />
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
