import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketSummary } from '@kamby/domain';
import { GridTerminalCell } from './GridTerminalCell';
import type { TradePanelStep } from '@/components/trading/TradePanel';

const { fetchTokenHistory } = vi.hoisted(() => ({ fetchTokenHistory: vi.fn() }));
vi.mock('@/lib/market-client', () => ({ fetchTokenHistory }));
// KambyChart and TradePanelCard both have (or, for TradePanelCard, deliberately will have
// separately) their own coverage — TradePanelCard especially is real trading-write-path
// territory this session's ground rules keep untouched. Mocked here so this file only
// exercises GridTerminalCell's own orchestration: which token/candles are fetched, the
// candlesStatus state machine, canTrade gating, and the inFlight token-switch guard.
vi.mock('@/components/terminal/KambyChart', () => ({
  KambyChart: ({ candles }: { candles: unknown[] }) => <div>{candles.length} candles</div>,
}));
vi.mock('@/components/terminal/TradePanelCard', () => ({
  IN_FLIGHT_STEPS: new Set(['review', 'approving', 'signing', 'pending']),
  TradePanelCard: ({
    chainId,
    tokenAddress,
    onStepChange,
  }: {
    chainId: number;
    tokenAddress: string;
    onStepChange: (step: TradePanelStep) => void;
  }) => (
    <div>
      <p>
        TradePanelCard: {tokenAddress} on {chainId}
      </p>
      <button type="button" onClick={() => onStepChange('review')}>
        Enter review
      </button>
      <button type="button" onClick={() => onStepChange('confirmed')}>
        Confirm trade
      </button>
    </div>
  ),
}));

function fakeMarket(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'eip155:8453',
    tokenAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    symbol: 'FOO',
    name: 'Foo Token',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'WETH',
    quoteAddress: '0xquote',
    quoteDecimals: 18,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 2.5,
    liquidityUsd: 75_000,
    volume24hUsd: 500_000,
    priceChange24hPct: -2,
    marketCapUsd: 1_000_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

describe('GridTerminalCell', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a real "pick a token" state and never fetches candles when nothing is selected', () => {
    render(<GridTerminalCell availableMarkets={[fakeMarket()]} initialMarket={null} />);

    expect(screen.getByText('Pick a token')).toBeInTheDocument();
    expect(screen.getByText('Pick a token to trade.')).toBeInTheDocument();
    expect(fetchTokenHistory).not.toHaveBeenCalled();
  });

  it('fetches real candle history for the initial market on mount', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket({ tokenAddress: '0xaaa', chainIdentifier: 'eip155:8453' });
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);

    await vi.waitFor(() => expect(fetchTokenHistory).toHaveBeenCalledWith('0xaaa', '1D', 8453));
  });

  it('shows a real error state, not a silent blank, when the candles fetch fails', async () => {
    fetchTokenHistory.mockRejectedValue(new Error('network error'));
    const market = fakeMarket();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);

    expect(await screen.findByText("Couldn't load chart")).toBeInTheDocument();
  });

  it('renders the real fetched candles once loaded', async () => {
    fetchTokenHistory.mockResolvedValue([{}, {}, {}]);
    const market = fakeMarket();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);

    expect(await screen.findByText('3 candles')).toBeInTheDocument();
  });

  it('shows a real "trading unavailable" message for a token missing real decimals data', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket({ decimals: null as unknown as number });
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);

    expect(await screen.findByText("Trading isn't available for this token yet.")).toBeInTheDocument();
    expect(screen.queryByText(/TradePanelCard:/)).not.toBeInTheDocument();
  });

  it('renders the real TradePanelCard with the correct chain and token once tradeable', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket({ tokenAddress: '0xaaa', chainIdentifier: 'eip155:56' });
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);

    expect(await screen.findByText('TradePanelCard: 0xaaa on 56')).toBeInTheDocument();
  });

  it('disables the token selector once a trade goes in-flight, to prevent switching tokens mid-trade', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket();
    const user = userEvent.setup();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);
    await screen.findByText(/TradePanelCard:/);
    expect(screen.getByRole('combobox')).not.toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Enter review' }));

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('re-enables the token selector once the trade leaves an in-flight step', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket();
    const user = userEvent.setup();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);
    await screen.findByText(/TradePanelCard:/);

    await user.click(screen.getByRole('button', { name: 'Enter review' }));
    await user.click(screen.getByRole('button', { name: 'Confirm trade' }));

    expect(screen.getByRole('combobox')).not.toBeDisabled();
  });

  it('refetches real candles with the new timeframe when a tab is changed', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket({ tokenAddress: '0xaaa' });
    const user = userEvent.setup();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} />);
    await vi.waitFor(() => expect(fetchTokenHistory).toHaveBeenCalledWith('0xaaa', '1D', 8453));

    await user.click(screen.getByRole('button', { name: '1H' }));

    await vi.waitFor(() => expect(fetchTokenHistory).toHaveBeenCalledWith('0xaaa', '1H', 8453));
  });

  it('hides the timeframe tabs entirely in compact mode', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const market = fakeMarket();
    render(<GridTerminalCell availableMarkets={[market]} initialMarket={market} compact />);
    await screen.findByText(/TradePanelCard:/);

    expect(screen.queryByRole('button', { name: '1H' })).not.toBeInTheDocument();
  });

  it('fetches real candles for a newly selected token, switching away from the initial one', async () => {
    fetchTokenHistory.mockResolvedValue([]);
    const marketA = fakeMarket({ tokenAddress: '0xaaa', symbol: 'AAA' });
    const marketB = fakeMarket({ tokenAddress: '0xbbb', symbol: 'BBB' });
    const user = userEvent.setup();
    render(<GridTerminalCell availableMarkets={[marketA, marketB]} initialMarket={marketA} />);
    await vi.waitFor(() => expect(fetchTokenHistory).toHaveBeenCalledWith('0xaaa', '1D', 8453));

    await user.selectOptions(screen.getByRole('combobox'), '$BBB');

    await vi.waitFor(() => expect(fetchTokenHistory).toHaveBeenCalledWith('0xbbb', '1D', 8453));
    expect(await screen.findByText('TradePanelCard: 0xbbb on 8453')).toBeInTheDocument();
  });
});
