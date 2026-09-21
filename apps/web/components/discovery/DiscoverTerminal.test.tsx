import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Candle, MarketSummary, TokenTraderConnection } from '@kamby/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TradePanelCardModule from '@/components/terminal/TradePanelCard';
import type * as WagmiModule from 'wagmi';
import { DiscoverTerminal } from './DiscoverTerminal';

const { fetchTokenHistoryMock, fetchLatestActivityMock, fetchTokenTradersMock } = vi.hoisted(() => ({
  fetchTokenHistoryMock: vi.fn(),
  fetchLatestActivityMock: vi.fn(),
  fetchTokenTradersMock: vi.fn(),
}));

vi.mock('@/lib/market-client', () => ({ fetchTokenHistory: fetchTokenHistoryMock }));
vi.mock('@/lib/social-client', () => ({ fetchLatestActivity: fetchLatestActivityMock, checkFollowStatus: vi.fn().mockResolvedValue(false) }));
// useChartOverlayFilter calls wagmi's useAccount directly (not through a mocked child
// component like TradePanelCard's own wagmi usage), so it needs its own stub here —
// no connected wallet in these tests, matching hasStoredSession: () => false below.
// Keeps every other real wagmi export (lib/wagmi-config.ts's `http` etc. still need them,
// even with TradePanelCard itself mocked below — something in the import graph still
// touches the real module).
vi.mock('wagmi', async (importOriginal) => {
  const actual = await importOriginal<typeof WagmiModule>();
  return { ...actual, useAccount: () => ({ address: undefined }) };
});
// hasStoredSession: () => false keeps MyPositionsPanel (rendered inside DiscoverTerminal)
// in its real, honest "no session" early-return state rather than needing a second mock.
// fetchTheses is stubbed too — TokenTradersPanel's own ThesisSection calls it on mount.
vi.mock('@/lib/discovery-client', () => ({
  fetchTokenTraders: fetchTokenTradersMock,
  hasStoredSession: () => false,
  fetchTheses: vi.fn().mockResolvedValue([]),
}));

// KambyChart (lightweight-charts, real <canvas> manipulation) and TradePanelCard
// (wagmi/Privy) are exercised by their own dedicated test files — stubbed here so this file
// stays focused on DiscoverTerminal's own new orchestration logic (selection state, fetch
// wiring, the race-condition guard), not their internals.
vi.mock('@/components/terminal/KambyChart', () => ({
  KambyChart: ({ candles }: { candles: Candle[] }) => <div data-testid="chart">{candles.length} candles</div>,
}));
vi.mock('@/components/terminal/TradePanelCard', async () => {
  const actual = await vi.importActual<typeof TradePanelCardModule>('@/components/terminal/TradePanelCard');
  return {
    IN_FLIGHT_STEPS: actual.IN_FLIGHT_STEPS,
    TradePanelCard: ({ tokenAddress }: { tokenAddress: string }) => (
      <div data-testid="trade-panel">Trading {tokenAddress}</div>
    ),
  };
});

function marketSummary(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    chainIdentifier: 'eip155:8453',
    tokenAddress: '0x4200000000000000000000000000000000000006',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    logoUrl: null,
    quoteSymbol: 'USDC',
    quoteAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    quoteDecimals: 6,
    dex: 'uniswap-v3',
    feeTier: 3000,
    priceUsd: 2500,
    liquidityUsd: 1_000_000,
    volume24hUsd: 500_000,
    priceChange24hPct: 3.2,
    marketCapUsd: 600_000_000,
    lastPriceUpdateAt: new Date().toISOString(),
    isStale: false,
    ...overrides,
  };
}

const emptyTraders: TokenTraderConnection = {
  uniqueTraders24h: null,
  recentTraders: [],
  activeTraders: [],
  recentLargeTrades: [],
  watcherCount: 0,
  buyCount24h: 0,
  sellCount24h: 0,
  buyerCount24h: 0,
  sellerCount24h: 0,
};

const marketA = marketSummary({ tokenAddress: '0xaaaa000000000000000000000000000000000a', symbol: 'AAA' });
const marketB = marketSummary({
  chainIdentifier: 'eip155:56',
  tokenAddress: '0xbbbb000000000000000000000000000000000b',
  symbol: 'BBB',
});

const defaultProps = {
  ranked: [marketA, marketB],
  trending: [],
  movers: [],
  byVolume: [],
  initialMarket: marketA,
  initialTimeframe: '1D' as const,
  initialCandles: [{ bucketStart: '2026-01-01T00:00:00.000Z', open: 1, high: 2, low: 0.5, close: 1.5 }] as Candle[],
  initialActivity: [],
  initialTraders: emptyTraders,
};

describe('DiscoverTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the default selection from initial* props with zero fetches before any click', async () => {
    render(<DiscoverTerminal {...defaultProps} />);

    expect(await screen.findByRole('button', { name: /AAA/ })).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toHaveTextContent('1 candles');
    expect(screen.getByTestId('trade-panel')).toHaveTextContent(marketA.tokenAddress);
    expect(fetchTokenHistoryMock).not.toHaveBeenCalled();
    expect(fetchLatestActivityMock).not.toHaveBeenCalled();
    expect(fetchTokenTradersMock).not.toHaveBeenCalled();
  });

  it('clicking a token in the left rail re-fetches candles/activity/traders for that token and updates the panels', async () => {
    fetchTokenHistoryMock.mockResolvedValue([
      { bucketStart: '2026-01-01T00:00:00.000Z', open: 1, high: 1, low: 1, close: 1 },
      { bucketStart: '2026-01-01T01:00:00.000Z', open: 1, high: 1, low: 1, close: 1 },
    ]);
    fetchLatestActivityMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchTokenTradersMock.mockResolvedValue(emptyTraders);
    render(<DiscoverTerminal {...defaultProps} />);
    await screen.findByRole('button', { name: /AAA/ });

    await userEvent.click(screen.getByRole('button', { name: /BBB/ }));

    await waitFor(() => expect(screen.getByTestId('trade-panel')).toHaveTextContent(marketB.tokenAddress));
    expect(fetchTokenHistoryMock).toHaveBeenCalledWith(marketB.tokenAddress, '1D', 56);
    expect(fetchLatestActivityMock).toHaveBeenCalledWith({ tokenAddress: marketB.tokenAddress, limit: 10 });
    expect(fetchTokenTradersMock).toHaveBeenCalledWith(marketB.tokenAddress, 56, 8);
    await waitFor(() => expect(screen.getByTestId('chart')).toHaveTextContent('2 candles'));
  });

  it('never lets a slow, earlier selection\'s response overwrite a newer selection', async () => {
    let resolveFirst!: (candles: Candle[]) => void;
    fetchTokenHistoryMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce([
        { bucketStart: '2026-01-01T00:00:00.000Z', open: 1, high: 1, low: 1, close: 1 },
      ]);
    fetchLatestActivityMock.mockResolvedValue({ items: [], nextCursor: null });
    fetchTokenTradersMock.mockResolvedValue(emptyTraders);
    const marketC = marketSummary({ tokenAddress: '0xcccc000000000000000000000000000000000c', symbol: 'CCC' });
    render(<DiscoverTerminal {...defaultProps} ranked={[marketA, marketB, marketC]} />);
    await screen.findByRole('button', { name: /AAA/ });

    // First click (slow, never resolves during this test) then a second, faster click.
    await userEvent.click(screen.getByRole('button', { name: /BBB/ }));
    await userEvent.click(screen.getByRole('button', { name: /CCC/ }));

    await waitFor(() => expect(screen.getByTestId('trade-panel')).toHaveTextContent(marketC.tokenAddress));
    await waitFor(() => expect(screen.getByTestId('chart')).toHaveTextContent('1 candles'));

    // The stale first request finally resolves — its result must never land, since a newer
    // selection has already superseded it.
    resolveFirst([
      { bucketStart: '2026-01-01T00:00:00.000Z', open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 },
      { bucketStart: '2026-01-01T01:00:00.000Z', open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 },
      { bucketStart: '2026-01-01T02:00:00.000Z', open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('trade-panel')).toHaveTextContent(marketC.tokenAddress);
    expect(screen.getByTestId('chart')).toHaveTextContent('1 candles');
  });
});
