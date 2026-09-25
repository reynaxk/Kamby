import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketHeader } from './MarketHeader';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// ConnectWalletButton itself is already independently tested (wagmi/session-dependent) —
// stubbed here so this file only exercises what actually changed. Captures the props it was
// called with so the expectedChainId-threading test below can assert on it directly, rather
// than trying to drive a real wallet-switch flow through a mock.
const connectWalletButtonProps = vi.fn();
vi.mock('@/components/wallet/ConnectWalletButton', () => ({
  ConnectWalletButton: (props: { expectedChainId?: number }) => {
    connectWalletButtonProps(props);
    return <div />;
  },
}));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => <div /> }));
// SendButton's own SendModal is independently tested (SendModal.test.tsx) and calls several
// Privy/wagmi hooks unconditionally on mount, open or not — stubbed here for the same
// reason ConnectWalletButton is.
vi.mock('@/components/wallet/SendButton', () => ({ SendButton: () => <div /> }));
// FundModal, same reasoning as SendButton/SendModal above (unconditional Privy/wagmi hooks).
vi.mock('@/components/wallet/FundButton', () => ({ FundButton: () => <div /> }));
// SearchBar's own live-typeahead behavior is covered by SearchBar.test.tsx — stubbed here
// (real fetchSearchResults) so a searchValue prop doesn't fire a real, unmocked fetch() in
// this file's tests.
vi.mock('@/lib/market-client', () => ({ fetchSearchResults: vi.fn().mockResolvedValue([]), fetchEvmChainConfigs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/account/BalanceVisibilityContext', () => ({
  useBalanceVisibility: () => ({ hidden: false, toggle: vi.fn() }),
}));

describe('MarketHeader', () => {
  it('renders the logo as a link back to Discover', () => {
    render(<MarketHeader />);
    expect(screen.getByRole('link', { name: /kamby/i })).toHaveAttribute('href', '/');
  });

  // Real removal, 2026-09-22: the top-level text nav (Discover/Trades/Watchlist/
  // Leaderboard/Referrals/Solana) is gone, matching fomo.family's own header, which carries
  // none either — navigation now happens through the terminal's own sidebar tabs instead.
  // The underlying routes still exist; only these header links are gone, which is the one
  // thing worth pinning down here so it can't silently regress back.
  it('shows no top-level text nav links', () => {
    render(<MarketHeader />);
    for (const label of ['Discover', 'Trades', 'Watchlist', 'Leaderboard', 'Referrals', 'Solana']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  it('renders the search bar', () => {
    render(<MarketHeader searchValue="WBNB" />);
    expect(screen.getByRole('textbox')).toHaveValue('WBNB');
  });

  it('passes expectedWalletChainId through to its own ConnectWalletButton instance — real bug fix 2026-09-17: on a BNB market page this header rendered a SEPARATE ConnectWalletButton that still defaulted to expecting Base, fighting the trade panel\'s own instance in an infinite auto-switch loop that left the wallet stuck on "Switching…" and the trade form unusable', () => {
    render(<MarketHeader expectedWalletChainId={56} />);

    expect(connectWalletButtonProps).toHaveBeenCalledWith(expect.objectContaining({ expectedChainId: 56 }));
  });

  it('leaves ConnectWalletButton to its own Base default when no wallet chain context is given', () => {
    render(<MarketHeader />);

    expect(connectWalletButtonProps).toHaveBeenCalledWith(expect.objectContaining({ expectedChainId: undefined }));
  });
});
