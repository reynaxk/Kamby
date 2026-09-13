'use client';

import { useEffect, useRef } from 'react';
import { CandlestickSeries, ColorType, createChart, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { MOCK_CANDLES } from './mock-data';

/** Reads a resolved `--kamby-*` token as an `rgb(...)` string lightweight-charts' canvas
 *  renderer can use directly — reading the actual computed value (rather than duplicating
 *  the terminal palette's hex codes here a second time) means this chart automatically
 *  matches `.kamby-terminal`'s colors with nothing to keep in sync by hand. */
function readColor(varName: string, el: Element): string {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim();
  return raw ? `rgb(${raw})` : '#000000';
}

/**
 * A native candlestick chart via TradingView's own open-source `lightweight-charts` —
 * deliberately not an iframe/embedded widget. Feeds from `MOCK_CANDLES` (see
 * PreviewBanner/mock-data.ts): this proves the real chart engine renders correctly styled
 * candles, wicks, grid, and price scale — wiring it to a real OHLC feed is separate,
 * backend-dependent work (Solana price-history ingestion doesn't exist yet).
 */
export function KambyChart() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const bg = readColor('--kamby-bg', container);
    const line = readColor('--kamby-line', container);
    const ink = readColor('--kamby-ink-600', container);
    const up = readColor('--kamby-up', container);
    const down = readColor('--kamby-down', container);

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
    });
    series.setData(MOCK_CANDLES.map((c) => ({ ...c, time: c.time as UTCTimestamp })));
    chart.timeScale().fitContent();

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
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
