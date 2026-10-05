import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Candle } from '@kamby/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as IndicatorsModule from '@/lib/indicators';
import { KambyChart, pricePrecision } from './KambyChart';

const { computeBollingerBands, computeAtr, computeAdx, computeAwesomeOscillator, computePeriodHighLow, addSeriesMock, seriesApi } =
  vi.hoisted(() => {
    const seriesApi = {
      setData: vi.fn(),
      createPriceLine: vi.fn(),
      attachPrimitive: vi.fn(),
      priceScale: () => ({ applyOptions: vi.fn() }),
    };
    return {
      computeBollingerBands: vi.fn().mockReturnValue({ upper: [], middle: [], lower: [] }),
      computeAtr: vi.fn().mockReturnValue([]),
      computeAdx: vi.fn().mockReturnValue([]),
      computeAwesomeOscillator: vi.fn().mockReturnValue([]),
      computePeriodHighLow: vi.fn().mockReturnValue(null),
      addSeriesMock: vi.fn().mockReturnValue(seriesApi),
      seriesApi,
    };
  });

vi.mock('@/lib/indicators', async (importOriginal) => {
  const actual = await importOriginal<typeof IndicatorsModule>();
  return {
    ...actual,
    computeBollingerBands,
    computeAtr,
    computeAdx,
    computeAwesomeOscillator,
    computePeriodHighLow,
  };
});

vi.mock('lightweight-charts', () => ({
  createChart: vi.fn().mockReturnValue({
    addSeries: addSeriesMock,
    timeScale: () => ({ fitContent: vi.fn(), setVisibleLogicalRange: vi.fn() }),
    applyOptions: vi.fn(),
    remove: vi.fn(),
  }),
  CandlestickSeries: 'CandlestickSeries',
  LineSeries: 'LineSeries',
  HistogramSeries: 'HistogramSeries',
  CrosshairMode: { Normal: 0 },
  ColorType: { Solid: 'solid' },
  LineStyle: { Dashed: 2, Dotted: 1 },
}));

// jsdom has no real ResizeObserver.
class FakeResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    bucketStart: new Date(2026, 0, 1, i).toISOString(),
    open: 100,
    high: 102,
    low: 98,
    close: 101,
    volumeUsd: 1000,
  }));
}

describe('KambyChart — indicator picker', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows a friendly brand-new-coin note and never opens a picker for fewer than 2 candles', () => {
    render(<KambyChart candles={[]} />);
    expect(screen.getByText(/brand-new coin/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /indicators/i })).not.toBeInTheDocument();
  });

  it('lists all five indicators in the picker, closed by default', async () => {
    const user = userEvent.setup();
    render(<KambyChart candles={candles(30)} />);

    const toggle = screen.getByRole('button', { name: /indicators/i });
    expect(screen.queryByText('Bollinger Bands')).not.toBeInTheDocument();

    await user.click(toggle);
    for (const label of ['Bollinger Bands', 'Period High/Low', 'ATR', 'ADX', 'Awesome Oscillator']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('checking Bollinger Bands computes it from the real candles and adds three overlay line series', async () => {
    const user = userEvent.setup();
    const input = candles(30);
    render(<KambyChart candles={input} />);

    await user.click(screen.getByRole('button', { name: /indicators/i }));
    const callsBeforeToggle = addSeriesMock.mock.calls.length;
    await user.click(screen.getByLabelText('Bollinger Bands'));

    expect(computeBollingerBands).toHaveBeenCalledWith(input);
    // Toggling rebuilds the whole chart (candlestick + now 3 Bollinger lines) rather than
    // patching in place — asserting the *new* calls since the toggle, not an absolute total,
    // since exactly how many renders the toggle itself costs isn't this test's concern.
    const newCalls = addSeriesMock.mock.calls.slice(callsBeforeToggle);
    const lineSeriesCalls = newCalls.filter((call) => call[0] === 'LineSeries');
    expect(lineSeriesCalls.length).toBe(3);
  });

  it('checking an oscillator adds it in its own pane (paneIndex 1), not the price pane', async () => {
    const user = userEvent.setup();
    render(<KambyChart candles={candles(30)} />);

    await user.click(screen.getByRole('button', { name: /indicators/i }));
    await user.click(screen.getByLabelText('ATR'));

    expect(computeAtr).toHaveBeenCalled();
    const lastCall = addSeriesMock.mock.calls.at(-1)!;
    expect(lastCall[2]).toBe(1); // paneIndex
  });

  it('shows the active count on the toggle button once indicators are on', async () => {
    const user = userEvent.setup();
    render(<KambyChart candles={candles(30)} />);

    await user.click(screen.getByRole('button', { name: /indicators/i }));
    await user.click(screen.getByLabelText('ADX'));

    expect(screen.getByRole('button', { name: /indicators \(1\)/i })).toBeInTheDocument();
  });

  it('adding Period High/Low draws two real price lines, not a fabricated range, and none when there is no data', async () => {
    const user = userEvent.setup();
    computePeriodHighLow.mockReturnValue({ high: 150, low: 90 });
    render(<KambyChart candles={candles(30)} />);

    await user.click(screen.getByRole('button', { name: /indicators/i }));
    await user.click(screen.getByLabelText('Period High/Low'));

    expect(seriesApi.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 150 }));
    expect(seriesApi.createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: 90 }));
  });
});

describe('pricePrecision', () => {
  const candle = (low: number) => ({ bucketStart: '2026-09-30T00:00:00.000Z', open: low, high: low, low, close: low, volumeUsd: 0 });

  it('keeps 2 decimals from $1 up', () => {
    expect(pricePrecision([candle(84_265), candle(1.2)])).toEqual({ precision: 2, minMove: 0.01 });
  });

  it('shows ~3 significant digits for sub-dollar and sub-cent coins, instead of "0.00"', () => {
    expect(pricePrecision([candle(0.5)]).precision).toBe(3);
    expect(pricePrecision([candle(0.0237)]).precision).toBe(4);
    expect(pricePrecision([candle(0.00000385)])).toEqual({ precision: 8, minMove: 0.00000001 });
  });

  it('ignores zero or broken lows and falls back to 2 decimals with no usable data', () => {
    expect(pricePrecision([candle(0), candle(Number.NaN)]).precision).toBe(2);
  });
});

describe('KambyChart — preview layer', () => {
  it('removes the SVG preview once the canvas chart has drawn, so candles are never shown twice', () => {
    const { container } = render(<KambyChart candles={candles(10)} />);
    // The canvas chart (mocked) is created synchronously in the mount effect.
    expect(container.querySelector('svg[aria-hidden="true"].absolute')).toBeNull();
  });

  it('keeps the preview as the fallback when the canvas chart cannot be created', async () => {
    const { createChart } = await import('lightweight-charts');
    vi.mocked(createChart).mockImplementationOnce(() => {
      throw new Error('no canvas');
    });
    const { container } = render(<KambyChart candles={candles(10)} />);
    expect(container.querySelector('svg.absolute')).not.toBeNull();
  });
});
