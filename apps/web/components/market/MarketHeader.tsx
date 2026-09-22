'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@kamby/ui';
import { BlurBalancesToggle } from '@/components/account/BlurBalancesToggle';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { SendButton } from '@/components/wallet/SendButton';
import { SearchBar } from './SearchBar';

const NAV_LINKS = [
  { href: '/', label: 'Discover' },
  { href: '/trades', label: 'Trades' },
  { href: '/watchlist', label: 'Watchlist' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/referrals', label: 'Referrals' },
  { href: '/solana', label: 'Solana' },
] as const;

/**
 * "Discover" is the one top-level nav destination — trader profiles (`/trader/[address]`)
 * are real as of Phase 2, but reached from activity/search/follows rather than a top-level
 * link, since there's no trader *listing* page to point a nav item at yet. "Trades" (Phase 3),
 * "Watchlist" (Phase 6), and "Referrals" (Phase 7) are the exceptions: each is every user's
 * own private state, worth a permanent link even with no public listing page behind it.
 * "Leaderboard" is the other exception — a real public trader-ranking *listing* page (see
 * docs/TRADER_INTELLIGENCE.md#realized-pnl), the nav destination Discover's own doc comment
 * above says doesn't exist yet for trader profiles generally.
 *
 * A Client Component (rather than composing a small nav-only client island) purely so
 * `usePathname()` can highlight whichever of the three links is actually current — every
 * child here (`SearchBar` aside) was already a Client Component anyway (wagmi/wallet
 * state), so this isn't giving up meaningful server rendering.
 */
export function MarketHeader({
  searchValue,
  expectedWalletChainId,
}: {
  searchValue?: string;
  /** Real bug fixed 2026-09-17: this header renders its own `ConnectWalletButton` instance,
   *  independent of any trade panel's — on the market detail page, that second instance
   *  defaulted to expecting Base (`ConnectWalletButton`'s own fallback) even on a BNB token
   *  page, so it kept fighting `TradePanel`'s instance to auto-switch the wallet back to
   *  Base every time the user got it onto BNB Chain to actually trade. The visible symptom
   *  was a permanently-stuck "Switching…" button and an unusable trade form underneath it.
   *  The market detail page now passes its own resolved chainId through so both instances
   *  agree on which chain the wallet should be on. */
  expectedWalletChainId?: number;
}) {
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
          // The Discover link stays a real, clickable link (never collapses to inert
          // highlighted text) while a search is active, even though pathname alone already
          // matches "/" — otherwise there's no way to get back to the unfiltered Discover
          // view except editing the URL by hand. Real bug reported 2026-09-17: a search
          // term the user could no longer clear because this nav item silently stopped
          // being a link the moment they were on "/" at all, search or not.
          const isActive =
            link.href === '/' ? pathname === '/' && !searchValue : pathname.startsWith(link.href);
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
          {/* Keyed on the server-known term so navigating between searches (or back to
              plain Discover) fully remounts SearchBar — its live-typeahead state (typed
              value, dropdown results) is now lifted into the component itself rather than
              living in the DOM input node, so only a real remount resets it. */}
          <SearchBar key={searchValue ?? ''} defaultValue={searchValue} />
          <BlurBalancesToggle />
          <SendButton />
          <NotificationBell />
          <ConnectWalletButton expectedChainId={expectedWalletChainId} />
        </div>
      </div>
    </header>
  );
}
