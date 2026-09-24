import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketSummary, PersonalizedToken } from '@kamby/domain';
import { PersonalizedDiscovery } from './PersonalizedDiscovery';

const { fetchPersonalizedDiscovery, hasStoredSession } = vi.hoisted(() => ({
  fetchPersonalizedDiscovery: vi.fn(),
  hasStoredSession: vi.fn(),
}));
vi.mock('@/lib/discovery-client', () => ({ fetchPersonalizedDiscovery, hasStoredSession }));
// TokenIdentity/PriceChange both have their own separate coverage; ReasonTag is a trivial
// single-prop span. All mocked here to isolate PersonalizedDiscovery's own logic.
vi.mock('@/components/market/TokenIdentity', () => ({
  TokenIdentity: ({ symbol }: { symbol: string | null }) => <span>{symbol}</span>,
}));
vi.mock('@/components/market/PriceChange', () => ({
  PriceChange: ({ value }: { value: number }) => <span>{value}%</span>,
}));
vi.mock('./ReasonTag', () => ({ ReasonTag: ({ reason }: { reason: string }) => <span>{reason}</span> }));

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

function fakeToken(overrides: Partial<PersonalizedToken> = {}): PersonalizedToken {
  return { market: fakeMarket(), score: 5, reasons: ['Because you follow Alex'], ...overrides };
}

describe('PersonalizedDiscovery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing at all and never fetches when there is no stored session', () => {
    hasStoredSession.mockReturnValue(false);
    const { container } = render(<PersonalizedDiscovery />);

    expect(container).toBeEmptyDOMElement();
    expect(fetchPersonalizedDiscovery).not.toHaveBeenCalled();
  });

  it('renders nothing at all on a fetch failure — this section simply disappears rather than showing an error', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockRejectedValue(new Error('network error'));
    const { container } = render(<PersonalizedDiscovery />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('shows a real distinct empty state once loaded with zero personalized picks', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([]);
    render(<PersonalizedDiscovery />);

    expect(await screen.findByText('Nothing personalized yet.')).toBeInTheDocument();
  });

  it('fetches the real personalized picks with the real limit', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([]);
    render(<PersonalizedDiscovery />);

    await vi.waitFor(() => expect(fetchPersonalizedDiscovery).toHaveBeenCalledWith(8));
  });

  it('links a Base-chain pick to its real chain-scoped URL', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([
      fakeToken({ market: fakeMarket({ chainIdentifier: 'eip155:8453', tokenAddress: '0xaaa' }) }),
    ]);
    render(<PersonalizedDiscovery />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it('links a BNB-chain pick to its own chain-scoped URL, never defaulting to Base', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([
      fakeToken({ market: fakeMarket({ chainIdentifier: 'eip155:56', tokenAddress: '0xbbb' }) }),
    ]);
    render(<PersonalizedDiscovery />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/bnb/0xbbb');
  });

  it('falls back to the default chain slug rather than crashing for an unrecognized chain identifier', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([
      fakeToken({ market: fakeMarket({ chainIdentifier: 'eip155:999999', tokenAddress: '0xccc' }) }),
    ]);
    render(<PersonalizedDiscovery />);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/market/base/0xccc');
  });

  it('renders every real reason tag for a pick with multiple reasons', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([fakeToken({ reasons: ['Because you follow Alex', 'Trending now'] })]);
    render(<PersonalizedDiscovery />);

    expect(await screen.findByText('Because you follow Alex')).toBeInTheDocument();
    expect(screen.getByText('Trending now')).toBeInTheDocument();
  });

  it('shows the real price and volume for each pick', async () => {
    hasStoredSession.mockReturnValue(true);
    fetchPersonalizedDiscovery.mockResolvedValue([fakeToken({ market: fakeMarket({ priceUsd: 3.5, volume24hUsd: 250_000 }) })]);
    render(<PersonalizedDiscovery />);

    expect(await screen.findByText('$3.50')).toBeInTheDocument();
    expect(screen.getByText('Volume $250.0K')).toBeInTheDocument();
  });
});
