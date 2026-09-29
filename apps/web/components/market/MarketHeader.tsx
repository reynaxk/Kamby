'use client';

import Link from 'next/link';
import { BlurBalancesToggle } from '@/components/account/BlurBalancesToggle';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { FundButton } from '@/components/wallet/FundButton';
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
  wide = false,
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
  /** Use the wider terminal shell on dense discovery surfaces without changing the
   * narrower content rhythm used by the rest of the app. */
  wide?: boolean;
}) {
  const shellClass = wide ? 'max-w-[1920px] px-2 sm:px-3' : 'max-w-6xl px-6';
  const actionsClass = wide
    ? 'ml-0 flex flex-1 flex-wrap items-center gap-2'
    : 'ml-auto flex flex-wrap items-center gap-3';

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur">
      <div
        className={`mx-auto flex flex-wrap items-center gap-3 ${wide ? 'py-2.5' : 'py-4'} ${shellClass}`}
      >
        <Link href="/" className="flex items-center gap-2">
          <KambyLogo size={wide ? 'sm' : 'md'} />
        </Link>
        <div className={`${actionsClass} ${wide ? 'kamby-header-actions' : ''}`}>
          {/* w-full below sm: the search input has no room to be usable squeezed onto the
              same row as five icon buttons + Sign in on a narrow phone (it was clipping to
              ~2 visible characters of its own placeholder) — full-width forces it onto its
              own wrapped row instead. Keyed on the server-known term so navigating between
              searches (or back to plain Discover) fully remounts SearchBar — its live-
              typeahead state (typed value, dropdown results) is now lifted into the
              component itself rather than living in the DOM input node, so only a real
              remount resets it. */}
          <div className={wide ? 'w-full sm:mx-auto sm:flex-1 sm:max-w-xl' : 'w-full sm:w-auto'}>
            <SearchBar key={searchValue ?? ''} defaultValue={searchValue} />
          </div>
          <BlurBalancesToggle />
          <FundButton />
          <SendButton />
          <NotificationBell />
          <ConnectWalletButton expectedChainId={expectedWalletChainId} />
        </div>
      </div>
    </header>
  );
}
