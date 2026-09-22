import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketHeader } from './MarketHeader';

const usePathname = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathname(), useRouter: () => ({ push: vi.fn() }) }));

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
// SearchBar's own live-typeahead behavior is covered by SearchBar.test.tsx — stubbed here
// (real fetchSearchResults) so a searchValue prop doesn't fire a real, unmocked fetch() in
// this file's tests.
vi.mock('@/lib/market-client', () => ({ fetchSearchResults: vi.fn().mockResolvedValue([]), fetchEvmChainConfigs: vi.fn().mockResolvedValue([]) }));
vi.mock('@/components/account/BalanceVisibilityContext', () => ({
  useBalanceVisibility: () => ({ hidden: false, toggle: vi.fn() }),
}));

describe('MarketHeader', () => {
  it('highlights Discover (not a link) when on the homepage', () => {
    usePathname.mockReturnValue('/');
    render(<MarketHeader />);

    expect(screen.getByText('Discover')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: /^Trades$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Watchlist$/i })).toBeInTheDocument();
  });

  it('highlights Trades (not a link) when on /trades, and Discover becomes a link', () => {
    usePathname.mockReturnValue('/trades');
    render(<MarketHeader />);

    expect(screen.getByText('Trades')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: /^Discover$/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /^Watchlist$/i })).toBeInTheDocument();
  });

  it('highlights Watchlist (not a link) when on /watchlist', () => {
    usePathname.mockReturnValue('/watchlist');
    render(<MarketHeader />);

    expect(screen.getByText('Watchlist')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: /^Trades$/i })).toBeInTheDocument();
  });

  it('highlights Referrals (not a link) when on /referrals', () => {
    usePathname.mockReturnValue('/referrals');
    render(<MarketHeader />);

    expect(screen.getByText('Referrals')).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: /^Watchlist$/i })).toBeInTheDocument();
  });

  it('treats a trades sub-route (e.g. /trades/abc123) as still under Trades', () => {
    usePathname.mockReturnValue('/trades/abc123');
    render(<MarketHeader />);

    expect(screen.getByText('Trades')).not.toHaveAttribute('href');
  });

  it('never highlights Discover for an unrelated route', () => {
    usePathname.mockReturnValue('/market/0xabc');
    render(<MarketHeader />);

    expect(screen.getByRole('link', { name: /^Discover$/i })).toHaveAttribute('href', '/');
  });

  it('keeps Discover a real, clickable link (not inert text) on the homepage while a search is active — real bug fix 2026-09-17: there was previously no way to click back to the unfiltered Discover view', () => {
    usePathname.mockReturnValue('/');
    render(<MarketHeader searchValue="WBNB" />);

    expect(screen.getByRole('link', { name: /^Discover$/i })).toHaveAttribute('href', '/');
  });

  it('passes expectedWalletChainId through to its own ConnectWalletButton instance — real bug fix 2026-09-17: on a BNB market page this header rendered a SEPARATE ConnectWalletButton that still defaulted to expecting Base, fighting the trade panel\'s own instance in an infinite auto-switch loop that left the wallet stuck on "Switching…" and the trade form unusable', () => {
    usePathname.mockReturnValue('/market/bnb/0xabc');
    render(<MarketHeader expectedWalletChainId={56} />);

    expect(connectWalletButtonProps).toHaveBeenCalledWith(expect.objectContaining({ expectedChainId: 56 }));
  });

  it('leaves ConnectWalletButton to its own Base default when no wallet chain context is given (Discover, Trades, Watchlist, etc.)', () => {
    usePathname.mockReturnValue('/');
    render(<MarketHeader />);

    expect(connectWalletButtonProps).toHaveBeenCalledWith(expect.objectContaining({ expectedChainId: undefined }));
  });
});
