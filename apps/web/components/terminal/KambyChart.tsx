'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
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
import { useTranslations } from 'next-intl';

export type ChartStyle = 'candles' | 'line';

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

/** Same as readColor, with transparency — `rgba(r, g, b, a)`, the form every canvas and
 *  lightweight-charts' own color parser accept. Exported for LivePriceChart. */
export function readRgba(varName: string, el: Element, alpha: number): string {
  const parts = getComputedStyle(el).getPropertyValue(varName).trim().split(/[\s,]+/).filter(Boolean);
  return parts.length >= 3 ? `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
}

/** Bars shown on first paint: enough to read at ~7px per candle, never all 200 squeezed in. */
function initialBarCount(width: number): number {
  return Math.max(30, Math.floor(width / 7));
}

const NO_TRADES: SocialActivity[] = [];

/**
 * Price-axis precision from the data itself — lightweight-charts defaults to 2 decimals,
 * which rendered every sub-cent memecoin's axis and last-price label as "0.00" (BONK at
 * $0.0000038, found 2026-09-30). $1 and up keeps 2 decimals; below that, enough decimals
 * for ~3 significant digits of the smallest price on screen. Exported for tests.
 */
export function pricePrecision(candles: Candle[]): { precision: number; minMove: number } {
  const lows = candles.map((c) => c.low).filter((v) => Number.isFinite(v) && v > 0);
  const smallest = lows.length > 0 ? Math.min(...lows) : 1;
  const precision = smallest >= 1 ? 2 : Math.min(12, Math.ceil(-Math.log10(smallest)) + 2);
  return { precision, minMove: Number((10 ** -precision).toFixed(precision)) };
}

/** The canvas can't resolve a CSS variable in `ctx.font` ("var(--font-jetbrains-mono)" made
 *  every chart label fall back to 10px sans-serif) — read the variable's actual font family
 *  (next/font's generated name) first. */
export function chartFontFamily(element: HTMLElement): string {
  const family = getComputedStyle(element).getPropertyValue('--font-jetbrains-mono').trim();
  return family ? `${family}, ui-monospace, monospace` : 'ui-monospace, monospace';
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
 * A lightweight DOM-rendered candle layer that keeps the terminal legible while the
 * canvas chart is initializing (and gives older/embedded browsers a usable visual if their
 * canvas implementation cannot paint the chart). It uses the same real OHLC values as the
 * interactive chart underneath; it is never a mock fallback or a generated trend line.
 *
 * Rendered only until the canvas chart has drawn (`canvasReady` in KambyChart) — it used to
 * stay on top permanently, so every chart showed its candles twice, with this layer's own
 * volume bars and "0.0000" axis labels spilling over the real price axis (found 2026-09-30).
 */
function CandlePreview({ candles, trades }: { candles: Candle[]; trades: SocialActivity[] }) {
  const width = 1000;
  const height = 500;
  const padX = 18;
  const padY = 16;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const range = Math.max(max - min, Number.EPSILON);
  const plotWidth = width - padX * 2;
  const volumeHeight = 54;
  const plotHeight = height - padY * 2 - volumeHeight;
  const volumeBase = height - padY;
  const step = plotWidth / candles.length;
  const y = (price: number) => padY + ((max - price) / range) * plotHeight;
  const maxVolume = Math.max(...candles.map((c) => c.volumeUsd ?? 0), 1);
  const labelIndices = [0, Math.floor(candles.length / 2), candles.length - 1];
  const firstTime = new Date(candles[0]?.bucketStart ?? 0).getTime();
  const lastTime = new Date(candles[candles.length - 1]?.bucketStart ?? 0).getTime();
  const timeRange = Math.max(lastTime - firstTime, 1);

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      {[0.2, 0.4, 0.6, 0.8].map((fraction) => (
        <line
          key={fraction}
          x1={padX}
          x2={width - padX}
          y1={padY + plotHeight * fraction}
          y2={padY + plotHeight * fraction}
          stroke="rgb(var(--kamby-line) / 0.65)"
          strokeWidth="1"
        />
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
        <text
          key={`price-${fraction}`}
          x={width - 2}
          y={padY + plotHeight * fraction + 4}
          fill="rgb(var(--kamby-ink-400))"
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          textAnchor="end"
        >
          {max - range * fraction < 1
            ? (max - range * fraction).toFixed(4)
            : Math.round(max - range * fraction)}
        </text>
      ))}
      {candles.map((candle, index) => {
        const x = padX + step * index + step / 2;
        const openY = y(candle.open);
        const closeY = y(candle.close);
        const bodyTop = Math.min(openY, closeY);
        const bodyHeight = Math.max(Math.abs(closeY - openY), 1.5);
        const up = candle.close >= candle.open;
        const color = up ? 'rgb(var(--kamby-up))' : 'rgb(var(--kamby-down))';
        const volume = candle.volumeUsd ?? 0;
        const volumeBarHeight = (volume / maxVolume) * (volumeHeight - 12);
        return (
          <g key={`${candle.bucketStart}-${index}`}>
            <line
              x1={x}
              x2={x}
              y1={y(candle.high)}
              y2={y(candle.low)}
              stroke={color}
              strokeWidth="1"
            />
            <rect
              x={x - Math.max(step * 0.28, 1)}
              y={bodyTop}
              width={Math.max(step * 0.56, 2)}
              height={bodyHeight}
              fill={color}
              rx="0.5"
            />
            <rect
              x={x - Math.max(step * 0.28, 1)}
              y={volumeBase - volumeBarHeight}
              width={Math.max(step * 0.56, 2)}
              height={Math.max(volumeBarHeight, 1)}
              fill={color}
              opacity="0.45"
            />
          </g>
        );
      })}
      {labelIndices.map((index) => {
        const candle = candles[index];
        if (!candle) return null;
        return (
          <text
            key={`time-${candle.bucketStart}`}
            x={padX + step * index + step / 2}
            y={height - 2}
            fill="rgb(var(--kamby-ink-400))"
            fontFamily="ui-monospace, monospace"
            fontSize="11"
            textAnchor="middle"
          >
            {candle.bucketStart.slice(11, 16)}
          </text>
        );
      })}
      {trades.map((trade, index) => {
        const timestamp = new Date(trade.timestamp).getTime();
        if (!Number.isFinite(timestamp) || timestamp < firstTime || timestamp > lastTime) return null;
        const x = padX + ((timestamp - firstTime) / timeRange) * plotWidth;
        const yPosition = y(trade.priceUsd);
        if (!Number.isFinite(yPosition) || yPosition < padY || yPosition > padY + plotHeight) return null;
        const color = trade.action === 'BUY' ? 'rgb(var(--kamby-up))' : 'rgb(var(--kamby-down))';
        return (
          <g key={`${trade.timestamp}-${trade.trader.address}-${index}`}>
            <circle cx={x} cy={yPosition} r="7" fill="rgb(var(--kamby-bg))" stroke={color} strokeWidth="2" />
            <circle cx={x} cy={yPosition} r="3" fill={color} />
          </g>
        );
      })}
    </svg>
  );
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
export function KambyChart({
  candles,
  trades = NO_TRADES,
  chartStyle = 'candles',
  entryPrice,
}: {
  candles: Candle[];
  trades?: SocialActivity[];
  /** 'line' draws closes as a line (the chart-style toggle). */
  chartStyle?: ChartStyle;
  /** Your average entry price in this coin, drawn as a dashed line. */
  entryPrice?: number | null;
}) {
  const tU = useTranslations('ui');
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  const markersRef = useRef<ChartTraderMarkers | null>(null);
  const tradesRef = useRef(trades);
  tradesRef.current = trades;
  // Refreshed candles update the live chart in place (2026-10-10, owner: the chart visibly
  // "refreshing" every few seconds was annoying) — it's only rebuilt when its shape changes:
  // another candle width, style, indicator or entry line.
  const candlesRef = useRef(candles);
  candlesRef.current = candles;
  const liveRef = useRef<{ series: ISeriesApi<'Area'> | ISeriesApi<'Candlestick'>; volume: ISeriesApi<'Histogram'> | null; lastLine: IPriceLine | null; line: boolean } | null>(null);
  const hasVolume = candles.some((c) => (c.volumeUsd ?? 0) > 0);
  const spacing = candles.length >= 2 ? new Date(candles[1]!.bucketStart).getTime() - new Date(candles[0]!.bucketStart).getTime() : 0;
  // Indicators are computed from the whole series, so with any on, new candles still rebuild.
  const buildKey = `${candles.length >= 2}|${spacing}|${hasVolume}|${activeIndicators.size > 0 ? `${candles.length}:${candles.at(-1)?.close}:${candles.at(-1)?.bucketStart}` : ''}`;

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node))
        setPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [pickerOpen]);

  useEffect(() => {
    const container = containerRef.current;
    const candles = candlesRef.current;
    if (!container || candles.length < 2) return;

    const bg = readColor('--kamby-bg', container);
    const gridLine = readRgba('--kamby-line', container, 0.45);
    const crosshairLine = readRgba('--kamby-ink-400', container, 0.5);
    const raised = readColor('--kamby-surface-raised', container);
    const ink = readColor('--kamby-ink-600', container);
    const up = readColor('--kamby-up', container);
    const down = readColor('--kamby-down', container);
    const accent = readColor('--kamby-accent', container);
    const accentInk = readColor('--kamby-accent-ink', container);

    let chart: IChartApi;
    try {
      chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: bg },
          textColor: ink,
          fontFamily: chartFontFamily(container),
          attributionLogo: false,
          fontSize: 11,
        },
        // Horizontal guides only, faint — full-strength grid lines both ways made the
        // candles hard to read (user feedback 2026-09-30: "the charts are bad looking").
        grid: {
          vertLines: { visible: false },
          horzLines: { color: gridLine },
        },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.22 } },
        timeScale: { borderVisible: false, timeVisible: true, rightOffset: 4, minBarSpacing: 2 },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: crosshairLine, style: LineStyle.Dashed, labelBackgroundColor: raised },
          horzLine: { color: crosshairLine, style: LineStyle.Dashed, labelBackgroundColor: raised },
        },
        autoSize: true,
      });
    } catch {
      // No usable canvas (old/embedded browsers) — CandlePreview stays up as the chart.
      return;
    }

    // Prices can't go below zero — the axis's bottom margin (room for volume) used to show
    // negative labels on tiny coins. Blank them; everything else formats as before.
    const { precision, minMove } = pricePrecision(candles);
    const priceFormat = { type: 'custom' as const, minMove, formatter: (price: number) => (price < 0 ? '' : price.toFixed(precision)) };
    // Candles, or a line of closes (the chart-style toggle, 2026-10-03). The library's own
    // last-price line/label is off either way — the accent-styled one below replaces it.
    const series =
      chartStyle === 'line'
        ? chart.addSeries(AreaSeries, {
            priceFormat,
            lineColor: accent,
            lineWidth: 2,
            topColor: readRgba('--kamby-accent', container, 0.25),
            bottomColor: readRgba('--kamby-accent', container, 0.02),
            priceLineVisible: false,
            lastValueVisible: false,
          })
        : chart.addSeries(CandlestickSeries, {
            priceFormat,
            upColor: up,
            downColor: down,
            borderVisible: false,
            wickUpColor: up,
            wickDownColor: down,
            priceLineVisible: false,
            lastValueVisible: false,
          });
    if (chartStyle === 'line') {
      (series as ISeriesApi<'Area'>).setData(toSeriesData(candles).map((c) => ({ time: c.time, value: c.close })));
    } else {
      (series as ISeriesApi<'Candlestick'>).setData(toSeriesData(candles));
    }

    let volumeSeries: ISeriesApi<'Histogram'> | null = null;
    let lastPriceLine: IPriceLine | null = null;

    // Your entry price (2026-10-06): a dashed line at what you paid — above it you're in profit.
    if (entryPrice && entryPrice > 0) {
      series.createPriceLine({ price: entryPrice, color: readRgba('--kamby-accent', container, 0.9), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: tU('yourEntry_eb36') });
    }

    // Volume along the bottom fifth, on its own hidden scale, colored by candle direction.
    if (candles.some((c) => (c.volumeUsd ?? 0) > 0)) {
      const upVolume = readRgba('--kamby-up', container, 0.35);
      const downVolume = readRgba('--kamby-down', container, 0.35);
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumeSeries = volume;
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      volume.setData(
        candles.map((c) => ({
          time: Math.floor(new Date(c.bucketStart).getTime() / 1000) as UTCTimestamp,
          value: c.volumeUsd ?? 0,
          color: c.close >= c.open ? upVolume : downVolume,
        })),
      );
    }

    // Always a normal candle width (~7px), newest on the right. Fitting a young coin's handful
    // of candles to the full width drew each one huge (user feedback 2026-10-04); with fewer
    // candles than fit, the left side simply stays empty.
    const bars = initialBarCount(container.clientWidth);
    chart.timeScale().setVisibleLogicalRange({ from: candles.length - bars, to: candles.length + 3 });
    setCanvasReady(true);

    // See chartTraderMarkers.ts's own doc comment for why this needs the primitive API
    // rather than the built-in setMarkers() — avatar images, not just colored shapes.
    const traderMarkers = new ChartTraderMarkers();
    series.attachPrimitive(traderMarkers);
    traderMarkers.setColors(up, down);
    traderMarkers.setTrades(tradesRef.current);
    markersRef.current = traderMarkers;

    // The chart is canvas-rendered, so none of the CSS glow shadows used elsewhere in the
    // terminal can reach it — a saturated accent line + filled axis-label chip is the
    // realistic "glow" here, not a compromise.
    const lastClose = candles[candles.length - 1]?.close;
    if (lastClose !== undefined) {
      lastPriceLine = series.createPriceLine({
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
      const bandOptions = {
        priceFormat,
        lineWidth: 1 as const,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
      chart
        .addSeries(LineSeries, { ...bandOptions, color: accent })
        .setData(toLineSeriesData(bands.upper));
      chart
        .addSeries(LineSeries, { ...bandOptions, color: ink })
        .setData(toLineSeriesData(bands.middle));
      chart
        .addSeries(LineSeries, { ...bandOptions, color: accent })
        .setData(toLineSeriesData(bands.lower));
    }
    if (activeIndicators.has('period-high-low')) {
      const range = computePeriodHighLow(candles);
      if (range) {
        const lineOptions = {
          lineWidth: 1 as const,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
        };
        series.createPriceLine({
          ...lineOptions,
          price: range.high,
          color: up,
          axisLabelColor: up,
          axisLabelTextColor: bg,
        });
        series.createPriceLine({
          ...lineOptions,
          price: range.low,
          color: down,
          axisLabelColor: down,
          axisLabelTextColor: bg,
        });
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
        .addSeries(
          LineSeries,
          { color: accent, lineWidth: 2, priceLineVisible: false, lastValueVisible: true },
          paneIndex,
        )
        .setData(toLineSeriesData(points));
    });

    // `autoSize` keeps the canvas matched to its container; the chart is only rebuilt when the
    // candles or indicators change — never on a parent re-render, and not for new trades
    // (the effect below updates those markers in place).
    liveRef.current = { series, volume: volumeSeries, lastLine: lastPriceLine, line: chartStyle === 'line' };
    return () => {
      liveRef.current = null;
      markersRef.current = null;
      chart.remove();
      setCanvasReady(false);
    };
  }, [buildKey, activeIndicators, chartStyle, entryPrice]); // eslint-disable-line react-hooks/exhaustive-deps

  // New candles for the same chart: swap the data, keep the view where the trader left it.
  useEffect(() => {
    const live = liveRef.current;
    const container = containerRef.current;
    if (!live || !container || candles.length < 2) return;
    const data = toSeriesData(candles);
    if (live.line) (live.series as ISeriesApi<'Area'>).setData(data.map((c) => ({ time: c.time, value: c.close })));
    else (live.series as ISeriesApi<'Candlestick'>).setData(data);
    if (live.volume) {
      const upVolume = readRgba('--kamby-up', container, 0.35);
      const downVolume = readRgba('--kamby-down', container, 0.35);
      live.volume.setData(
        candles.map((c) => ({
          time: Math.floor(new Date(c.bucketStart).getTime() / 1000) as UTCTimestamp,
          value: c.volumeUsd ?? 0,
          color: c.close >= c.open ? upVolume : downVolume,
        })),
      );
    }
    const lastClose = candles[candles.length - 1]?.close;
    if (live.lastLine && lastClose !== undefined) live.lastLine.applyOptions({ price: lastClose });
  }, [candles]);

  useEffect(() => {
    markersRef.current?.setTrades(trades);
  }, [trades]);

  if (candles.length < 2) {
    return (
      <EmptyState
        title={tU('brandNewCoinNoCandles_eeab')}
        detail="Switch to Live or 10s to watch it move in real time."
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
      {!canvasReady && <CandlePreview candles={candles} trades={trades} />}
      {/* Top-left: at top-right it covered the price axis and the live price (2026-10-06). */}
      <div ref={pickerRef} className="absolute left-2 top-2 z-10">
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
          <div className="absolute left-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
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
