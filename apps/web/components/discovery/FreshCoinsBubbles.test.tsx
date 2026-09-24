import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PumpFunTokenSummary } from '@kamby/domain';
import { FreshCoinsBubbles } from './FreshCoinsBubbles';

const { fetchTrenches } = vi.hoisted(() => ({ fetchTrenches: vi.fn() }));
vi.mock('@/lib/trenches-client', () => ({ fetchTrenches }));

function fakeToken(overrides: Partial<PumpFunTokenSummary> = {}): PumpFunTokenSummary {
  return {
    mintAddress: 'FakeMintAddressForTestingOnly1111111111111',
    name: 'Fresh Coin',
    symbol: 'FRESH',
    uri: null,
    virtualSolReserves: '0',
    virtualTokenReserves: '0',
    realSolReserves: '0',
    realTokenReserves: '0',
    tokenTotalSupply: '0',
    graduationProgressPct: 50,
    complete: false,
    createdAt: new Date().toISOString(),
    graduatedAt: null,
    ...overrides,
  };
}

describe('FreshCoinsBubbles', () => {
  beforeEach(() => {
    // jsdom implements neither requestAnimationFrame nor cancelAnimationFrame at all — the
    // component's own physics loop would throw the instant BubbleField mounts with any real
    // tokens. A no-op stub lets the loop "start" without ever actually running a frame, which
    // is exactly what these tests want: the bubbles' initial synchronous position (from the
    // separate, non-RAF effect that populates bubblesRef) is what's under test here, not the
    // frame-by-frame movement itself — animation timing is deliberately out of scope, same
    // caution this session has applied to every other animation-driven component.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('shows a real loading indicator before the first fetch resolves', () => {
    fetchTrenches.mockReturnValue(new Promise(() => {}));
    render(<FreshCoinsBubbles />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders nothing at all when the fetch fails, never a broken panel', async () => {
    fetchTrenches.mockRejectedValue(new Error('network error'));
    const { container } = render(<FreshCoinsBubbles />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing at all once loaded with zero fresh tokens, rather than an empty panel shell', async () => {
    fetchTrenches.mockResolvedValue([]);
    const { container } = render(<FreshCoinsBubbles />);

    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('fetches the real FRESH category with the real limit', async () => {
    fetchTrenches.mockResolvedValue([]);
    render(<FreshCoinsBubbles />);

    await vi.waitFor(() => expect(fetchTrenches).toHaveBeenCalledWith('FRESH', 24));
  });

  it('renders a real bubble linking to Solscan for each fresh token, with its symbol shown', async () => {
    fetchTrenches.mockResolvedValue([fakeToken({ mintAddress: 'Mint1', symbol: 'PEPE' })]);
    render(<FreshCoinsBubbles />);

    const link = await screen.findByRole('link', { name: /\$PEPE/ });
    expect(link).toHaveAttribute('href', 'https://solscan.io/token/Mint1');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('falls back to a truncated mint address when a token has no real symbol', async () => {
    fetchTrenches.mockResolvedValue([fakeToken({ mintAddress: 'MintNoSymbol1111', symbol: null })]);
    render(<FreshCoinsBubbles />);

    expect(await screen.findByText('Mint')).toBeInTheDocument(); // first 4 chars of the mint address
  });

  it('sizes a bubble at the real minimum radius for a token with no graduation progress at all', async () => {
    fetchTrenches.mockResolvedValue([fakeToken({ mintAddress: 'Mint1', graduationProgressPct: 0 })]);
    render(<FreshCoinsBubbles />);

    const link = await screen.findByRole('link');
    expect(link).toHaveStyle({ width: '52px', height: '52px' }); // 2 * MIN_RADIUS (26)
  });

  it('sizes a bubble at the real maximum radius for a token right at graduation', async () => {
    fetchTrenches.mockResolvedValue([fakeToken({ mintAddress: 'Mint1', graduationProgressPct: 100 })]);
    render(<FreshCoinsBubbles />);

    const link = await screen.findByRole('link');
    expect(link).toHaveStyle({ width: '116px', height: '116px' }); // 2 * MAX_RADIUS (58)
  });

  it('clamps a real out-of-range graduation percentage rather than sizing outside the min/max bounds', async () => {
    fetchTrenches.mockResolvedValue([fakeToken({ mintAddress: 'Mint1', graduationProgressPct: 250 })]);
    render(<FreshCoinsBubbles />);

    const link = await screen.findByRole('link');
    expect(link).toHaveStyle({ width: '116px', height: '116px' }); // clamped to 100%, same as MAX_RADIUS
  });

  it('applies the real glow treatment only once a token is close to graduation (>=70%)', async () => {
    fetchTrenches.mockResolvedValue([
      fakeToken({ mintAddress: 'Mint1', symbol: 'CLOSE', graduationProgressPct: 85 }),
      fakeToken({ mintAddress: 'Mint2', symbol: 'FAR', graduationProgressPct: 20 }),
    ]);
    render(<FreshCoinsBubbles />);

    const close = await screen.findByRole('link', { name: /\$CLOSE/ });
    const far = screen.getByRole('link', { name: /\$FAR/ });
    expect(close.className).toContain('shadow-glow-accent');
    expect(far.className).not.toContain('shadow-glow-accent');
  });

  it('polls again for fresh tokens every 12s', async () => {
    vi.useFakeTimers();
    fetchTrenches.mockResolvedValue([]);
    render(<FreshCoinsBubbles />);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTrenches).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetchTrenches).toHaveBeenCalledTimes(2);
  });
});
