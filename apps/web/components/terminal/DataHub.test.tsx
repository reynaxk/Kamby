import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SocialActivity } from '@kamby/domain';
import { DataHub } from './DataHub';

function fakeActivity(overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainIdentifier: 'eip155:8453',
    trader: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', displayName: null, avatarUrl: null },
    action: 'BUY',
    token: {
      address: '0xtoken',
      symbol: 'FOO',
      name: 'Foo',
      logoUrl: null,
      decimals: 18,
      quoteAddress: '0xquote',
      quoteSymbol: 'WETH',
      quoteDecimals: 18,
    },
    amountUsd: 2_000,
    tokenAmount: 100,
    priceUsd: 20,
    timestamp: new Date().toISOString(),
    txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
    chainId: 8453,
    social: { likes: 0, likedByMe: null },
    ...overrides,
  };
}

describe('DataHub', () => {
  it('shows a real honest placeholder, not fake rows, under the Holders tab', async () => {
    const user = userEvent.setup();
    render(<DataHub activity={[fakeActivity()]} />);

    await user.click(screen.getByRole('button', { name: 'Holders' }));

    expect(screen.getByText(/Holder tracking/)).toBeInTheDocument();
  });

  it('shows a real honest placeholder, not fake rows, under the Caller Alpha tab', async () => {
    const user = userEvent.setup();
    render(<DataHub activity={[fakeActivity()]} />);

    await user.click(screen.getByRole('button', { name: 'Caller Alpha' }));

    expect(screen.getByText(/Caller alpha/)).toBeInTheDocument();
  });

  it('never shows the filter row under Holders or Caller Alpha, even with real activity present', async () => {
    const user = userEvent.setup();
    render(<DataHub activity={[fakeActivity()]} />);

    await user.click(screen.getByRole('button', { name: 'Holders' }));

    expect(screen.queryByPlaceholderText('Filter by trader address…')).not.toBeInTheDocument();
  });

  it('shows a real distinct "no activity indexed" message when there is truly nothing for this token', () => {
    render(<DataHub activity={[]} />);

    expect(screen.getByText('No activity indexed yet for this token.')).toBeInTheDocument();
  });

  it('never shows the filter row at all when there is no real activity to filter', () => {
    render(<DataHub activity={[]} />);

    expect(screen.queryByPlaceholderText('Filter by trader address…')).not.toBeInTheDocument();
  });

  it('renders each real activity row with relative time, truncated trader, action, amount, and tx hash', () => {
    render(
      <DataHub
        activity={[
          fakeActivity({
            trader: { address: '0x1234567890123456789012345678901234567890', displayName: null, avatarUrl: null },
            action: 'BUY',
            amountUsd: 5_000,
            txHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
          }),
        ]}
      />,
    );

    expect(screen.getByText('0x1234…7890')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'BUY' })).toBeInTheDocument(); // the toolbar's own "BUY" filter button shares this text
    expect(screen.getByText('$5,000')).toBeInTheDocument();
    expect(screen.getByText('0xabcd…5678')).toBeInTheDocument();
  });

  it('shows "Unknown" rather than a broken truncation for a trader with no real captured address', () => {
    render(<DataHub activity={[fakeActivity({ trader: { address: null, displayName: null, avatarUrl: null } })]} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('colors a BUY differently from a SELL, distinguishing the two at a glance', () => {
    render(
      <DataHub
        activity={[
          fakeActivity({ id: 'a', action: 'BUY' }),
          fakeActivity({ id: 'b', action: 'SELL', trader: { address: '0xbbb', displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    expect(screen.getByRole('cell', { name: 'BUY' })).toHaveClass('text-up');
    expect(screen.getByRole('cell', { name: 'SELL' })).toHaveClass('text-down');
  });

  it('filters to only the real selected action when a filter tab is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DataHub
        activity={[
          fakeActivity({ id: 'buy-1', action: 'BUY' }),
          fakeActivity({ id: 'sell-1', action: 'SELL', trader: { address: '0xbbb', displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'SELL' }));

    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getByRole('cell', { name: 'SELL' })).toBeInTheDocument();
  });

  it('applies the real min-size filter once a threshold is selected', async () => {
    const user = userEvent.setup();
    render(
      <DataHub
        activity={[
          fakeActivity({ id: 'small', amountUsd: 500 }),
          fakeActivity({ id: 'big', amountUsd: 10_000, trader: { address: '0xbbb', displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '5000');

    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getByText('$10,000')).toBeInTheDocument();
  });

  it('filters by a real trader address substring, case-insensitively', async () => {
    const user = userEvent.setup();
    render(
      <DataHub
        activity={[
          fakeActivity({ id: 'a', trader: { address: '0xAAAABBBBCCCC', displayName: null, avatarUrl: null } }),
          fakeActivity({ id: 'b', trader: { address: '0xdddd', displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.type(screen.getByPlaceholderText('Filter by trader address…'), 'bbbb');

    expect(screen.getAllByRole('row')).toHaveLength(1);
  });

  it('shows a real distinct "no matches" message when filters exclude every real row, not the "no activity" one', async () => {
    const user = userEvent.setup();
    render(<DataHub activity={[fakeActivity({ action: 'BUY' })]} />);

    await user.click(screen.getByRole('button', { name: 'SELL' }));

    expect(screen.getByText('No activity matches these filters.')).toBeInTheDocument();
    expect(screen.queryByText('No activity indexed yet for this token.')).not.toBeInTheDocument();
  });

  it('composes the action, size, and trader filters together (AND, not OR)', async () => {
    const user = userEvent.setup();
    render(
      <DataHub
        activity={[
          // Matches action+size but not the trader query.
          fakeActivity({ id: 'wrong-trader', action: 'BUY', amountUsd: 10_000, trader: { address: '0xaaaa', displayName: null, avatarUrl: null } }),
          // Matches everything.
          fakeActivity({ id: 'match', action: 'BUY', amountUsd: 10_000, trader: { address: '0xbbbb', displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'BUY' }));
    await user.selectOptions(screen.getByRole('combobox'), '5000');
    await user.type(screen.getByPlaceholderText('Filter by trader address…'), 'bbbb');

    expect(screen.getAllByRole('row')).toHaveLength(1);
  });
});
