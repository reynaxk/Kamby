import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Candle } from '@kamby/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetChartDataCache } from '@/lib/chart-data';
import { TokenChartCard } from './TokenChartCard';

const { fetchTokenHistoryMock } = vi.hoisted(() => ({ fetchTokenHistoryMock: vi.fn() }));
vi.mock('@/lib/market-client', () => ({ fetchTokenHistory: fetchTokenHistoryMock }));
vi.mock('./KambyChart', () => ({ KambyChart: ({ candles }: { candles: Candle[] }) => <div data-testid="candles">{candles.length} candles</div> }));
vi.mock('./LivePriceChart', () => ({
  LivePriceChart: ({ seedCandles }: { seedCandles: Candle[] }) => <div data-testid="live">live from {seedCandles.length}</div>,
}));

const candle = (i: number): Candle => ({ bucketStart: new Date(2026, 0, 1, i).toISOString(), open: 1, high: 1, low: 1, close: 1, volumeUsd: 0 });
const source = { kind: 'evm', chain: 'base', address: '0xaaaa000000000000000000000000000000000001', chainId: 8453 } as const;

describe('TokenChartCard', () => {
  beforeEach(() => {
    resetChartDataCache();
    fetchTokenHistoryMock.mockReset();
  });

  it('switches timeframe in place, and switching back to a loaded width needs no new request', async () => {
    fetchTokenHistoryMock.mockResolvedValue([candle(0), candle(1), candle(2)]);
    render(<TokenChartCard source={source} initialTimeframe="1D" initialCandles={[candle(0), candle(1)]} />);
    await waitFor(() => expect(screen.getByTestId('candles')).toHaveTextContent('2 candles'));
    const callsAtStart = fetchTokenHistoryMock.mock.calls.length;

    await userEvent.click(screen.getByRole('button', { name: '4H' }));
    await waitFor(() => expect(screen.getByTestId('candles')).toHaveTextContent('3 candles'));
    expect(fetchTokenHistoryMock).toHaveBeenLastCalledWith(source.address, '4H', 8453);

    const callsAfter4H = fetchTokenHistoryMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: '1D' }));
    await waitFor(() => expect(screen.getByTestId('candles')).toHaveTextContent('2 candles'));
    expect(fetchTokenHistoryMock.mock.calls.length).toBe(callsAfter4H);
    expect(callsAfter4H).toBeGreaterThan(callsAtStart);
  });

  it('"Live" seeds the live line from 1m candles, never from the previous width', async () => {
    let resolve1m!: (c: Candle[]) => void;
    fetchTokenHistoryMock.mockImplementation((_a: string, tf: string) =>
      tf === '1m' ? new Promise<Candle[]>((r) => (resolve1m = r)) : Promise.resolve([candle(0), candle(1)]),
    );
    render(<TokenChartCard source={source} initialTimeframe="1D" initialCandles={[candle(0), candle(1)]} />);

    await userEvent.click(screen.getByRole('button', { name: 'Live' }));
    expect(screen.queryByTestId('live')).not.toBeInTheDocument();
    expect(screen.getByTestId('candles')).toBeInTheDocument();

    resolve1m([candle(0), candle(1), candle(2), candle(3)]);
    await waitFor(() => expect(screen.getByTestId('live')).toHaveTextContent('live from 4'));
  });
});
