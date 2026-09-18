import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MarketSummary, PumpFunTokenSummary } from '@kamby/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as TrenchesClientModule from '@/lib/trenches-client';
import { TrenchesPanel } from './TrenchesPanel';

const { fetchTrenchesMock } = vi.hoisted(() => ({ fetchTrenchesMock: vi.fn() }));

vi.mock('@/lib/trenches-client', async () => {
  const actual = await vi.importActual<typeof TrenchesClientModule>('@/lib/trenches-client');
  return { ...actual, fetchTrenches: fetchTrenchesMock };
});

function pumpFunToken(overrides: Partial<PumpFunTokenSummary> = {}): PumpFunTokenSummary {
  return {
    mintAddress: 'MintAddress111111111111111111111111111111',
    name: 'Test Coin',
    symbol: 'TEST',
    uri: null,
    virtualSolReserves: '30000000000',
    virtualTokenReserves: '1073000000000000',
    realSolReserves: '10000000000', // 10 SOL
    realTokenReserves: '793100000000000',
    tokenTotalSupply: '1000000000000000',
    graduationProgressPct: 11.76,
    complete: false,
    createdAt: new Date().toISOString(),
    graduatedAt: null,
    ...overrides,
  };
}

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

describe('TrenchesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads FRESH by default and shows the graduation progress bar for an incomplete curve', async () => {
    fetchTrenchesMock.mockResolvedValue([pumpFunToken()]);
    render(<TrenchesPanel />);

    expect(await screen.findByText('$TEST')).toBeInTheDocument();
    expect(screen.getByText('10.00 SOL raised')).toBeInTheDocument();
    expect(screen.getByText('12%')).toBeInTheDocument(); // 11.76 rounded
    expect(fetchTrenchesMock).toHaveBeenCalledWith('FRESH');
  });

  it('shows an honest empty state, never fabricated rows, when a trench has nothing yet', async () => {
    fetchTrenchesMock.mockResolvedValue([]);
    render(<TrenchesPanel />);

    expect(await screen.findByText('No tokens in this trench right now.')).toBeInTheDocument();
  });

  it('shows an honest error state when the request fails', async () => {
    fetchTrenchesMock.mockRejectedValue(new Error('network error'));
    render(<TrenchesPanel />);

    expect(await screen.findByText("Couldn't load this trench.")).toBeInTheDocument();
  });

  it('switches category on tab click and refetches', async () => {
    fetchTrenchesMock.mockResolvedValue([pumpFunToken()]);
    render(<TrenchesPanel />);
    await screen.findByText('$TEST');

    fetchTrenchesMock.mockResolvedValue([pumpFunToken({ complete: true, graduatedAt: new Date().toISOString() })]);
    await userEvent.click(screen.getByRole('button', { name: 'Graduated' }));

    await waitFor(() => expect(fetchTrenchesMock).toHaveBeenLastCalledWith('JUST_GRADUATED'));
    expect(await screen.findByText('Graduated just now')).toBeInTheDocument();
  });

  it('never shows the SOL-raised progress line for an already-graduated token', async () => {
    fetchTrenchesMock.mockResolvedValue([pumpFunToken({ complete: true, graduatedAt: new Date().toISOString() })]);
    render(<TrenchesPanel />);

    await screen.findByText('$TEST');
    expect(screen.queryByText(/SOL raised/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^\d+%$/)).not.toBeInTheDocument();
  });

  it('renders real TRENDING_HOLDERS market rows as links to the real market page', async () => {
    // The default tab is FRESH (a Pump.fun category) — the mock must answer that initial
    // fetch with FRESH-shaped data too, or the component would try to render a
    // MarketSummary as a PumpFunTokenSummary before the tab switch ever happens.
    fetchTrenchesMock.mockImplementation((category: string) =>
      Promise.resolve(category === 'TRENDING_HOLDERS' ? [marketSummary()] : [pumpFunToken()]),
    );
    render(<TrenchesPanel />);
    await screen.findByText('$TEST');

    await userEvent.click(screen.getByRole('button', { name: 'Trending' }));

    const link = await screen.findByRole('link', { name: /WETH/ });
    expect(link).toHaveAttribute('href', '/market/base/0x4200000000000000000000000000000000000006');
  });

  it('falls back to a truncated mint address when a Pump.fun token has no symbol', async () => {
    fetchTrenchesMock.mockResolvedValue([pumpFunToken({ symbol: null })]);
    render(<TrenchesPanel />);

    expect(await screen.findByText('MintAd…1111')).toBeInTheDocument();
  });
});
