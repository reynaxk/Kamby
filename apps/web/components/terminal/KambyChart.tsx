'use client';

import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, createChart, LineSeries, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle, SocialActivity } from '@kamby/domain';
import { EmptyState } from '@/components/market/EmptyState';
import {
  computeAdx,
  computeAtr,
  computeAwesomeOscillator,
  computeBollingerBands,
  computePeriodHighLow,
  OSCILLATOR_IDS,
  type IndicatorId,
  type OscillatorIndicatorId,
  type TimedValue,
} from '@/lib/indicators';
import { ChartTraderMarkers } from './chartTraderMarkers';

const INDICATOR_LABELS: Record<IndicatorId, string> = {
  bollinger: 'Bollinger Bands',
  'period-high-low': 'Period High/Low',
  atr: 'ATR',
  adx: 'ADX',
  'awesome-oscillator': 'Awesome Oscillator',
};
const INDICATOR_ORDER: IndicatorId[] = ['bollinger', 'period-high-low', ...OSCILLATOR_IDS];

function toLineSeriesData(points: TimedValue[]) {
  return points.map((p) => ({ time: p.time as UTCTimestamp, value: p.value }));
}

function oscillatorData(id: OscillatorIndicatorId, candles: Candle[]): TimedValue[] {
  if (id === 'atr') return computeAtr(candles);
  if (id === 'adx') return computeAdx(candles);
  return computeAwesomeOscillator(candles);
}

/** Reads a resolved `--kamby-*` token as an `rgb(...)` string lightweight-charts' canvas
 *  renderer can use directly — reading the actual computed value (rather than duplicating
 *  the terminal palette's hex codes here a second time) means this chart automatically
 *  matches `.kamby-void`'s colors with nothing to keep in sync by hand. */
function readColor(varName: string, el: Element): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim();
  return raw ? `rgb(${raw})` : '#000000';
}

function toSeriesData(candles: Candle[]) {
  return candles.map((c) => ({
    time: Math.floor(new Date(c.bucketStart).getTime() / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

/**
 * A native candlestick chart via TradingView's own open-source `lightweight-charts` —
 * deliberately not an iframe/embedded widget. Kamby's counterpart to
 * components/market/PriceChart.tsx's SVG line chart: same real, persisted candle data (the
 * same `candles` a caller already fetched via `fetchTokenHistory`), rendered with real
 * wicks/OHLC and TradingView-grade interaction (crosshair, zoom/pan) instead of a flat line.
 * As of 2026-09-15 this replaced PriceChart on the Market detail page; the two are no
 * longer maintained in parallel. `candles` is a required prop — no hidden mock fallback —
 * so every call site stays honest about whether what it's showing is real.
 */
export function KambyChart({ candles, trades = [] }: { candles: Candle[]; trades?: SocialActivity[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [pickerOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length < 2) return;

    const bg = readColor('--kamby-bg', container);
    const line = readColor('--kamby-line', container);
    const ink = readColor('--kamby-ink-600', container);
    const up = readColor('--kamby-up', container);
    const down = readColor('--kamby-down', container);
    const accent = readColor('--kamby-accent', container);
    const accentInk = readColor('--kamby-accent-ink', container);

    const chart: IChartApi = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: bg },
        textColor: ink,
        fontFamily: 'var(--font-jetbrains-mono), ui-monospace, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: line },
        horzLines: { color: line },
      },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true },
      crosshair: { vertLine: { color: line }, horzLine: { color: line } },
      width: container.clientWidth,
      height: container.clientHeight,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderVisible: false,
      wickUpColor: up,
      wickDownColor: down,
      // The library's own default last-price line/label is replaced by the accent-styled
      // one below — leaving both on drew two overlapping labels for the same value.
      priceLineVisible: false,
      lastValueVisible: false,
    });
    series.setData(toSeriesData(candles));
    chart.timeScale().fitContent();

    // See chartTraderMarkers.ts's own doc comment for why this needs the primitive API
    // rather than the built-in setMarkers() — avatar images, not just colored shapes.
    const traderMarkers = new ChartTraderMarkers();
    series.attachPrimitive(traderMarkers);
    traderMarkers.setColors(up, down);
    traderMarkers.setTrades(trades);

    // The chart is canvas-rendered, so none of the CSS glow shadows used elsewhere in the
    // terminal can reach it — a saturated accent line + filled axis-label chip is the
    // realistic "glow" here, not a compromise.
    const lastClose = candles[candles.length - 1]?.close;
    if (lastClose !== undefined) {
      series.createPriceLine({
        price: lastClose,
        color: accent,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        axisLabelColor: accent,
        axisLabelTextColor: accentInk,
      });
    }

    // Overlays (same price scale as candles) — added only when toggled on, computed fresh
    // from these same `candles` every rebuild, same "never a separate fetch" rule as
    // ChartTraderMarkers above.
    if (activeIndicators.has('bollinger')) {
      const bands = computeBollingerBands(candles);
      const bandOptions = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      chart.addSeries(LineSeries, { ...bandOptions, color: accent }).setData(toLineSeriesData(bands.upper));
      chart.addSeries(LineSeries, { ...bandOptions, color: ink }).setData(toLineSeriesData(bands.middle));
      chart.addSeries(LineSeries, { ...bandOptions, color: accent }).setData(toLineSeriesData(bands.lower));
    }
    if (activeIndicators.has('period-high-low')) {
      const range = computePeriodHighLow(candles);
      if (range) {
        const lineOptions = { lineWidth: 1 as const, lineStyle: LineStyle.Dotted, axisLabelVisible: true };
        series.createPriceLine({ ...lineOptions, price: range.high, color: up, axisLabelColor: up, axisLabelTextColor: bg });
        series.createPriceLine({ ...lineOptions, price: range.low, color: down, axisLabelColor: down, axisLabelTextColor: bg });
      }
    }

    // Oscillators — each gets its own pane (a fresh one is created automatically the first
    // time a series asks for a paneIndex that doesn't exist yet): ADX (0-100), ATR (a price-
    // magnitude number), and Awesome Oscillator (unbounded) have too different a scale to
    // ever share one axis honestly, unlike the overlays above.
    const activeOscillators = OSCILLATOR_IDS.filter((id) => activeIndicators.has(id));
    activeOscillators.forEach((id, i) => {
      const paneIndex = i + 1;
      const points = oscillatorData(id, candles);
      chart
        .addSeries(LineSeries, { color: accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true }, paneIndex)
        .setData(toLineSeriesData(points));
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, trades, activeIndicators]);

  if (candles.length < 2) {
    return (
      <EmptyState
        title="Not enough price history yet"
        detail="The ingestion worker is still building up real history for this market. Check back once it's had more time to index."
      />
    );
  }

  function toggleIndicator(id: IndicatorId) {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={pickerRef} className="absolute right-2 top-2 z-10">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          aria-haspopup="true"
          aria-expanded={pickerOpen}
          className="rounded-md border border-line bg-surface/90 px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wide text-ink-400 backdrop-blur hover:text-ink-900"
        >
          Indicators{activeIndicators.size > 0 ? ` (${activeIndicators.size})` : ''}
        </button>
        {pickerOpen && (
          <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
            {INDICATOR_ORDER.map((id) => (
              <label
                key={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-body text-xs text-ink-900 hover:bg-surface-raised"
              >
                <input
                  type="checkbox"
                  checked={activeIndicators.has(id)}
                  onChange={() => toggleIndicator(id)}
                  className="h-3 w-3 accent-accent"
                />
                {INDICATOR_LABELS[id]}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
