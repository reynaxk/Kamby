'use client';

import Link from 'next/link';
import { KambyLogo } from '@/components/layout/KambyLogo';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { UsdcBalancePill } from '@/components/wallet/UsdcBalancePill';
import { SearchBar } from './SearchBar';

/**
 * No top-level text nav (Discover/Trades/Watchlist/Leaderboard/Referrals/Solana) as of
 * 2026-09-22 — removed to match fomo.family's actual header, which carries none either;
 * navigation there happens through the terminal's own sidebar tabs (Alerts/Tokens/
 * Leaderboard/Feed — see DiscoverTerminal.tsx), not a permanent top-level link row. The
 * underlying routes (`/trades`, `/watchlist`, `/leaderboard`, `/referrals`, `/solana`)
 * still exist and are still reachable directly — only the header links to them are gone.
 *
 * Wallet tools (hide balances, Fund, Send) moved off the header to /account on 2026-09-30
 * (user request) — the header keeps search, notifications and the profile menu
 * (ConnectWalletButton's signed-in state, see ProfileMenu), and never prints the wallet
 * address.
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
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/95 backdrop-blur">
      <div
        className={`mx-auto flex flex-wrap items-center gap-x-3 gap-y-2 ${wide ? 'py-2.5' : 'py-3 sm:py-4'} ${shellClass}`}
      >
        <Link href="/terminal" className="flex items-center gap-2">
          <KambyLogo size={wide ? 'sm' : 'md'} />
        </Link>
        {/* Phones: logo + bell + Sign in share the first row and search gets its own full-width
            row below (`order-last`) — it used to push the bell and Sign in onto a second row
            of their own, ~150px of header on every page. From sm up: logo · search · actions.
            Keyed on the server-known term so navigating between searches (or back to plain
            Discover) fully remounts SearchBar and resets its typeahead state. */}
        <div className={`order-last w-full sm:order-none ${wide ? 'sm:mx-auto sm:max-w-xl sm:flex-1' : 'sm:ml-auto sm:w-auto'}`}>
          <SearchBar key={searchValue ?? ''} defaultValue={searchValue} />
        </div>
        <div className={`ml-auto flex items-center gap-2 sm:ml-0 ${wide ? 'kamby-header-actions' : 'sm:gap-3'}`}>
          <UsdcBalancePill />
          <ConnectWalletButton expectedChainId={expectedWalletChainId} enforceChain={false} />
        </div>
      </div>
    </header>
  );
}
