'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '@kamby/domain';
import { EmptyState } from '@/components/market/EmptyState';

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
export function KambyChart({ candles }: { candles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, [candles]);

  if (candles.length < 2) {
    return (
      <EmptyState
        title="Not enough price history yet"
        detail="The ingestion worker is still building up real history for this market. Check back once it's had more time to index."
      />
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
