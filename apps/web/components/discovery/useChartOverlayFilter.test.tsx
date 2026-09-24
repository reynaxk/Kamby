import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SocialActivity } from '@kamby/domain';
import { useChartOverlayFilter } from './useChartOverlayFilter';

const { useAccount, checkFollowStatus } = vi.hoisted(() => ({
  useAccount: vi.fn<() => { address: string | undefined }>(() => ({ address: undefined })),
  checkFollowStatus: vi.fn(),
}));
vi.mock('wagmi', () => ({ useAccount }));
vi.mock('@/lib/social-client', () => ({ checkFollowStatus }));

const MY_ADDRESS = '0x1111111111111111111111111111111111111a';
const FRIEND_ADDRESS = '0x2222222222222222222222222222222222222b';
const STRANGER_ADDRESS = '0x3333333333333333333333333333333333333c';

function fakeTrade(overrides: Partial<SocialActivity> = {}): SocialActivity {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainIdentifier: 'eip155:8453',
    trader: { address: STRANGER_ADDRESS, displayName: null, avatarUrl: null },
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
    txHash: '0xtx',
    chainId: 8453,
    social: { likes: 0, likedByMe: null },
    ...overrides,
  };
}

function Harness({ trades }: { trades: SocialActivity[] }) {
  const [filtered, controls] = useChartOverlayFilter(trades);
  return (
    <div>
      {controls}
      <ul>
        {filtered.map((t) => (
          <li key={t.id}>{t.id}</li>
        ))}
      </ul>
    </div>
  );
}

describe('useChartOverlayFilter', () => {
  afterEach(() => {
    vi.clearAllMocks();
    useAccount.mockReturnValue({ address: undefined });
  });

  it('includes every trade by default — My swaps on, Friends only off, no size floor', () => {
    render(<Harness trades={[fakeTrade({ id: 'a' }), fakeTrade({ id: 'b' })]} />);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });

  it('applies the real min-size floor once a threshold is selected', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        trades={[fakeTrade({ id: 'small', amountUsd: 500 }), fakeTrade({ id: 'big', amountUsd: 20_000 })]}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox'), '5000');

    expect(screen.queryByText('small')).not.toBeInTheDocument();
    expect(screen.getByText('big')).toBeInTheDocument();
  });

  it('hides my own trades once "My swaps" is unchecked, case-insensitively matching my address', async () => {
    useAccount.mockReturnValue({ address: MY_ADDRESS });
    const user = userEvent.setup();
    render(
      <Harness
        trades={[
          fakeTrade({ id: 'mine', trader: { address: MY_ADDRESS.toUpperCase(), displayName: null, avatarUrl: null } }),
          fakeTrade({ id: 'other', trader: { address: STRANGER_ADDRESS, displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'My swaps' }));

    expect(screen.queryByText('mine')).not.toBeInTheDocument();
    expect(screen.getByText('other')).toBeInTheDocument();
  });

  it('never resolves follow status until Friends only is actually checked', () => {
    render(<Harness trades={[fakeTrade({ id: 'a', trader: { address: STRANGER_ADDRESS, displayName: null, avatarUrl: null } })]} />);

    expect(checkFollowStatus).not.toHaveBeenCalled();
  });

  it('resolves follow status only for the unique trader addresses actually present', async () => {
    checkFollowStatus.mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <Harness
        trades={[
          fakeTrade({ id: 'a', trader: { address: FRIEND_ADDRESS, displayName: null, avatarUrl: null } }),
          fakeTrade({ id: 'b', trader: { address: FRIEND_ADDRESS, displayName: null, avatarUrl: null } }), // same trader again
        ]}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Friends only' }));

    await waitFor(() => expect(checkFollowStatus).toHaveBeenCalledTimes(1)); // deduplicated, not once per trade
    expect(checkFollowStatus).toHaveBeenCalledWith(FRIEND_ADDRESS);
  });

  it('narrows to followed traders once resolved, excluding a real stranger', async () => {
    checkFollowStatus.mockImplementation(async (addr: string) => addr === FRIEND_ADDRESS);
    const user = userEvent.setup();
    render(
      <Harness
        trades={[
          fakeTrade({ id: 'friend', trader: { address: FRIEND_ADDRESS, displayName: null, avatarUrl: null } }),
          fakeTrade({ id: 'stranger', trader: { address: STRANGER_ADDRESS, displayName: null, avatarUrl: null } }),
        ]}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Friends only' }));

    await waitFor(() => expect(screen.getByText('friend')).toBeInTheDocument());
    expect(screen.queryByText('stranger')).not.toBeInTheDocument();
  });

  it('treats "friends only" as inclusive of my own trades, even though I don\'t follow myself', async () => {
    useAccount.mockReturnValue({ address: MY_ADDRESS });
    checkFollowStatus.mockResolvedValue(false); // I don't "follow" my own wallet
    const user = userEvent.setup();
    render(
      <Harness trades={[fakeTrade({ id: 'mine', trader: { address: MY_ADDRESS, displayName: null, avatarUrl: null } })]} />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Friends only' }));
    await waitFor(() => expect(checkFollowStatus).toHaveBeenCalled());

    expect(screen.getByText('mine')).toBeInTheDocument(); // still shown — Friends only never excludes myself
  });

  it('excludes even my own trades under Friends only once My swaps is also turned off', async () => {
    useAccount.mockReturnValue({ address: MY_ADDRESS });
    checkFollowStatus.mockResolvedValue(false);
    const user = userEvent.setup();
    render(
      <Harness trades={[fakeTrade({ id: 'mine', trader: { address: MY_ADDRESS, displayName: null, avatarUrl: null } })]} />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Friends only' }));
    await user.click(screen.getByRole('checkbox', { name: 'My swaps' }));

    expect(screen.queryByText('mine')).not.toBeInTheDocument();
  });
});
