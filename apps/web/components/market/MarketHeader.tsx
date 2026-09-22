'use client';

import Link from 'next/link';
import { BlurBalancesToggle } from '@/components/account/BlurBalancesToggle';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { SendButton } from '@/components/wallet/SendButton';
import { SearchBar } from './SearchBar';

/**
 * No top-level text nav (Discover/Trades/Watchlist/Leaderboard/Referrals/Solana) as of
 * 2026-09-22 — removed to match fomo.family's actual header, which carries none either;
 * navigation there happens through the terminal's own sidebar tabs (Alerts/Tokens/
 * Leaderboard/Feed — see DiscoverTerminal.tsx), not a permanent top-level link row. The
 * underlying routes (`/trades`, `/watchlist`, `/leaderboard`, `/referrals`, `/solana`)
 * still exist and are still reachable directly — only the header links to them are gone.
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
