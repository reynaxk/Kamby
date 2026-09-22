import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyPositionsPanel } from './MyPositionsPanel';

const { fetchMyPositions, hasStoredSession, useBalanceVisibility } = vi.hoisted(() => ({
  fetchMyPositions: vi.fn(),
  hasStoredSession: vi.fn(),
  useBalanceVisibility: vi.fn(),
}));

vi.mock('@/lib/discovery-client', () => ({ fetchMyPositions, hasStoredSession }));
vi.mock('@/components/account/BalanceVisibilityContext', () => ({ useBalanceVisibility }));

const POSITION = {
  tokenAddress: '0xabc',
  symbol: 'PEPE',
  name: 'Pepe',
  logoUrl: null,
  quantity: 100,
  costBasisUsd: 50,
  currentPriceUsd: 0.6,
  currentValueUsd: 60,
  unrealizedPnlUsd: 10,
  unrealizedPnlPct: 20,
};

describe('MyPositionsPanel', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders nothing without a stored session, and never fetches', () => {
    hasStoredSession.mockReturnValue(false);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    const { container } = render(<MyPositionsPanel />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMyPositions).not.toHaveBeenCalled();
  });

  it('shows open positions in the clear by default', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyPositions.mockResolvedValue([POSITION]);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    render(<MyPositionsPanel />);

    const value = await screen.findByText('$60.00');
    expect(value.className).not.toMatch(/blur/);
  });

  it('visually blurs the dollar values when balances are hidden', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyPositions.mockResolvedValue([POSITION]);
    useBalanceVisibility.mockReturnValue({ hidden: true });
    render(<MyPositionsPanel />);

    const value = await screen.findByText('$60.00');
    expect(value.parentElement?.className).toMatch(/blur/);
  });

  it('reveals a real "what if sold now" sentence on click, computed from the actual position fields, and hides it again on a second click', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchMyPositions.mockResolvedValue([POSITION]);
    useBalanceVisibility.mockReturnValue({ hidden: false });
    const user = userEvent.setup();
    render(<MyPositionsPanel />);

    const row = await screen.findByRole('button', { name: /PEPE/ });
    expect(screen.queryByText(/walk away with/)).not.toBeInTheDocument();

    await user.click(row);
    expect(screen.getByText(/walk away with/)).toBeInTheDocument();
    expect(screen.getByText(/\+\$10\.00 \(\+20\.00%\)/)).toBeInTheDocument();

    await user.click(row);
    expect(screen.queryByText(/walk away with/)).not.toBeInTheDocument();
  });
});
