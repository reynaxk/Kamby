import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TokenTraderConnection } from '@kamby/domain';
import { TokenTradersPanel } from './TokenTradersPanel';

// This iteration scopes to TokenTradersPanel's own stat-line/buy-sell-bar logic — its
// ThesisSection child has a real, separate async fetch + optimistic-submit state machine
// that deserves its own focused pass, not a rushed add-on here. Mocking discovery-client
// just keeps that child inert (resolves to an empty list) rather than erroring in tests.
const { fetchTheses } = vi.hoisted(() => ({ fetchTheses: vi.fn() }));
vi.mock('@/lib/discovery-client', () => ({ fetchTheses, setMyThesis: vi.fn() }));

function fakeTrader(overrides: Partial<TokenTraderConnection['recentTraders'][number]> = {}) {
  return {
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    username: null,
    avatarUrl: null,
    lastTradeAt: new Date().toISOString(),
    tradeCount24h: null,
    ...overrides,
  };
}

function fakeConnection(overrides: Partial<TokenTraderConnection> = {}): TokenTraderConnection {
  return {
    uniqueTraders24h: null,
    recentTraders: [fakeTrader()],
    activeTraders: [],
    recentLargeTrades: [],
    watcherCount: 0,
    buyCount24h: 0,
    sellCount24h: 0,
    buyerCount24h: 0,
    sellerCount24h: 0,
    ...overrides,
  };
}

describe('TokenTradersPanel', () => {
  it('shows a real empty state, not a blank panel, when no traders have been indexed', () => {
    fetchTheses.mockResolvedValue([]);
    render(<TokenTradersPanel connection={fakeConnection({ recentTraders: [] })} tokenAddress="0xabc" chainId={8453} />);
    expect(screen.getByText('No traders indexed yet.')).toBeInTheDocument();
  });

  it('shows neither the unique-traders nor the watching line when both are absent (null/zero)', () => {
    fetchTheses.mockResolvedValue([]);
    render(
      <TokenTradersPanel
        connection={fakeConnection({ uniqueTraders24h: null, watcherCount: 0 })}
        tokenAddress="0xabc"
        chainId={8453}
      />,
    );
    expect(screen.queryByText(/unique traders/)).not.toBeInTheDocument();
    expect(screen.queryByText(/watching/)).not.toBeInTheDocument();
  });

  it('shows only the unique-traders line when there are no watchers', () => {
    fetchTheses.mockResolvedValue([]);
    render(
      <TokenTradersPanel
        connection={fakeConnection({ uniqueTraders24h: 42, watcherCount: 0 })}
        tokenAddress="0xabc"
        chainId={8453}
      />,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/unique traders in the last 24h/)).toBeInTheDocument();
    expect(screen.queryByText(/watching/)).not.toBeInTheDocument();
  });

  it('pluralizes "person" vs "people" correctly for the watcher count', () => {
    // The count and the label render in separate DOM nodes (the count has its own <span>),
    // so each needs its own query rather than one regex spanning both.
    fetchTheses.mockResolvedValue([]);
    const { rerender, container } = render(
      <TokenTradersPanel connection={fakeConnection({ watcherCount: 1 })} tokenAddress="0xabc" chainId={8453} />,
    );
    expect(container).toHaveTextContent('1 person watching');

    rerender(<TokenTradersPanel connection={fakeConnection({ watcherCount: 5 })} tokenAddress="0xabc" chainId={8453} />);
    expect(container).toHaveTextContent('5 people watching');
  });

  it('never shows the buy/sell bar when there is no real 24h trading activity to split', () => {
    fetchTheses.mockResolvedValue([]);
    render(
      <TokenTradersPanel
        connection={fakeConnection({ buyCount24h: 0, sellCount24h: 0 })}
        tokenAddress="0xabc"
        chainId={8453}
      />,
    );
    expect(screen.queryByText(/buys ·/)).not.toBeInTheDocument();
  });

  it('shows the real buy/sell split once there is real 24h activity', () => {
    fetchTheses.mockResolvedValue([]);
    render(
      <TokenTradersPanel
        connection={fakeConnection({ buyCount24h: 7, sellCount24h: 3, buyerCount24h: 5, sellerCount24h: 2 })}
        tokenAddress="0xabc"
        chainId={8453}
      />,
    );
    expect(screen.getByText('7 buys · 5 buyers')).toBeInTheDocument();
    expect(screen.getByText('3 sells · 2 sellers')).toBeInTheDocument();
  });

  it('never shows the "Most active today" section when there are no active traders', () => {
    fetchTheses.mockResolvedValue([]);
    render(<TokenTradersPanel connection={fakeConnection({ activeTraders: [] })} tokenAddress="0xabc" chainId={8453} />);
    expect(screen.queryByText('Most active today')).not.toBeInTheDocument();
  });

  it('shows the "Most active today" section once there is at least one real active trader', () => {
    fetchTheses.mockResolvedValue([]);
    render(
      <TokenTradersPanel
        connection={fakeConnection({ activeTraders: [fakeTrader({ address: '0xactive', tradeCount24h: 9 })] })}
        tokenAddress="0xabc"
        chainId={8453}
      />,
    );
    expect(screen.getByText('Most active today')).toBeInTheDocument();
    expect(screen.getByText('9 trades')).toBeInTheDocument();
  });
});
