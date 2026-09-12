import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarketHeader } from './MarketHeader';

const usePathname = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }));

// Both are already independently tested (wagmi/session-dependent) — stubbed here so this
// file only exercises what actually changed: which nav link gets the "current page" style.
vi.mock('@/components/wallet/ConnectWalletButton', () => ({ ConnectWalletButton: () => <div /> }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => <div /> }));

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
});
