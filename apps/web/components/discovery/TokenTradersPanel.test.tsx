import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenThesis, TokenTraderConnection } from '@kamby/domain';
import { TokenTradersPanel } from './TokenTradersPanel';

const { fetchTheses, setMyThesis } = vi.hoisted(() => ({ fetchTheses: vi.fn(), setMyThesis: vi.fn() }));
vi.mock('@/lib/discovery-client', () => ({ fetchTheses, setMyThesis }));

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

function fakeThesis(overrides: Partial<TokenThesis> = {}): TokenThesis {
  return {
    userId: '11111111-1111-1111-1111-111111111111',
    username: 'whale1',
    avatarUrl: null,
    walletAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    text: 'Long-term hold, real utility.',
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TokenTradersPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

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

describe('TokenTradersPanel > ThesisSection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading state, then the real fetched theses', async () => {
    fetchTheses.mockResolvedValue([fakeThesis({ text: 'Real conviction here.' })]);
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByText('Real conviction here.')).toBeInTheDocument();
  });

  it('shows the real "no one has posted" message once loaded with nothing, not stuck loading', async () => {
    fetchTheses.mockResolvedValue([]);
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);

    expect(await screen.findByText("No one's posted a thesis on this token yet.")).toBeInTheDocument();
  });

  it('shows a real error message, never a silent blank, when the fetch fails', async () => {
    fetchTheses.mockRejectedValue(new Error('network error'));
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);

    expect(await screen.findByText("Couldn't load theses.")).toBeInTheDocument();
  });

  it('disables Post thesis until real non-whitespace text is entered', async () => {
    fetchTheses.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);
    await screen.findByText("No one's posted a thesis on this token yet.");

    const button = screen.getByRole('button', { name: 'Post thesis' });
    const textarea = screen.getByPlaceholderText('Why are you holding this? (or would you)');
    expect(button).toBeDisabled();

    await user.type(textarea, '   ');
    expect(button).toBeDisabled(); // whitespace-only never counts as real content

    await user.type(textarea, 'Real reason');
    expect(button).not.toBeDisabled();
  });

  it('truncates typed input at the real character limit rather than accepting unlimited text', async () => {
    fetchTheses.mockResolvedValue([]);
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);
    await screen.findByText("No one's posted a thesis on this token yet.");

    // fireEvent.change (one DOM event with the full string), not userEvent.type — typing 300
    // real characters one keystroke at a time is real but needlessly slow for what this
    // specific test verifies (the truncation itself, not per-keystroke behavior).
    const textarea = screen.getByPlaceholderText('Why are you holding this? (or would you)') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'x'.repeat(300) } });

    expect(textarea.value).toHaveLength(280);
    expect(screen.getByText('280/280')).toBeInTheDocument();
  });

  it('submits the real trimmed text and shows it immediately once posted', async () => {
    fetchTheses.mockResolvedValue([]);
    setMyThesis.mockResolvedValue(fakeThesis({ userId: 'me', text: 'My real thesis' }));
    const user = userEvent.setup();
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);
    await screen.findByText("No one's posted a thesis on this token yet.");

    const textarea = screen.getByPlaceholderText('Why are you holding this? (or would you)');
    await user.type(textarea, 'My real thesis');
    await user.click(screen.getByRole('button', { name: 'Post thesis' }));

    expect(setMyThesis).toHaveBeenCalledWith('0xabc', 8453, 'My real thesis');
    expect(await screen.findByText('My real thesis')).toBeInTheDocument();
    await waitFor(() => expect(textarea).toHaveValue('')); // the draft clears on real success
  });

  it('replaces an existing thesis from the same user rather than showing a duplicate', async () => {
    fetchTheses.mockResolvedValue([fakeThesis({ userId: 'me', text: 'Old take' })]);
    setMyThesis.mockResolvedValue(fakeThesis({ userId: 'me', text: 'Updated take' }));
    const user = userEvent.setup();
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);
    await screen.findByText('Old take');

    await user.type(screen.getByPlaceholderText('Why are you holding this? (or would you)'), 'Updated take');
    await user.click(screen.getByRole('button', { name: 'Post thesis' }));

    expect(await screen.findByText('Updated take')).toBeInTheDocument();
    expect(screen.queryByText('Old take')).not.toBeInTheDocument();
  });

  it('leaves the draft intact for a retry, never silently discarding it, when the post fails', async () => {
    fetchTheses.mockResolvedValue([]);
    setMyThesis.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<TokenTradersPanel connection={fakeConnection()} tokenAddress="0xabc" chainId={8453} />);
    await screen.findByText("No one's posted a thesis on this token yet.");

    const textarea = screen.getByPlaceholderText('Why are you holding this? (or would you)');
    await user.type(textarea, 'My real thesis');
    await user.click(screen.getByRole('button', { name: 'Post thesis' }));

    await waitFor(() => expect(setMyThesis).toHaveBeenCalled());
    expect(textarea).toHaveValue('My real thesis'); // not cleared — the honest retry state
  });
});
