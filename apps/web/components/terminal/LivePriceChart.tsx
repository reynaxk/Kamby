'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  ColorType,
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '@kamby/domain';
import { fetchLivePrice, type ChartSource } from '@/lib/chart-data';
import { chartFontFamily, pricePrecision, readRgba } from './KambyChart';

const POLL_MS = 2_000;
/** The last hour of 1m closes as the line's starting history. */
const SEED_POINTS = 60;
const MAX_POINTS = 2_000;

interface Point {
  time: UTCTimestamp;
  value: number;
}

/** Only 1m closes this recent seed the line — a coin whose last trade was hours ago starts fresh. */
const SEED_MAX_AGE_S = 2 * 60 * 60;
/** Empty time slots laid out before the first live tick, so the line grows in from the right
 *  edge instead of one point rendering as a single wide blob. */
const LEAD_IN_S = 180;

/** Exported for tests. The seed line from 1m candles: their recent closes, oldest first. */
export function seedPoints(candles: Candle[], nowS: number): Point[] {
  return candles
    .slice(-SEED_POINTS)
    .map((c) => ({ time: Math.floor(new Date(c.bucketStart).getTime() / 1000) as UTCTimestamp, value: c.close }))
    .filter((p) => p.time >= nowS - SEED_MAX_AGE_S && p.time < nowS);
}

/** Exported for tests. Whitespace (time-only) points every poll interval up to now. */
export function leadInSlots(lastSeedS: number | null, nowS: number): { time: UTCTimestamp }[] {
  const step = POLL_MS / 1000;
  const slots: { time: UTCTimestamp }[] = [];
  for (let t = Math.max((lastSeedS ?? 0) + step, nowS - LEAD_IN_S); t < nowS; t += step) slots.push({ time: t as UTCTimestamp });
  return slots;
}

/**
 * The chart's "Live" timeframe (user request 2026-09-30): a price line that moves in real
 * time. Starts from the last hour of 1-minute closes, then appends the latest price every 2s
 * (GET /market/live-price — one batched DexScreener lookup server-side for every coin anyone
 * is watching). Polling pauses while the tab is hidden. Updated in place with
 * `series.update()`, never rebuilt per tick.
 */
export function LivePriceChart({ source, seedCandles }: { source: ChartSource; seedCandles: Candle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const lastTimeRef = useRef(0);
  const hasPriceHistoryRef = useRef(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [price, setPrice] = useState<number | null>(seedCandles[seedCandles.length - 1]?.close ?? null);

  const sourceKey = source.kind === 'solana' ? source.mint : `${source.chainId}:${source.address}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const accent = readRgba('--kamby-accent', container, 1);
    let chart: IChartApi;
    try {
      chart = createChart(container, {
        layout: {
          background: { type: ColorType.Solid, color: readRgba('--kamby-bg', container, 1) },
          textColor: readRgba('--kamby-ink-600', container, 1),
          fontFamily: chartFontFamily(container),
          fontSize: 11,
        },
        grid: { vertLines: { visible: false }, horzLines: { color: readRgba('--kamby-line', container, 0.45) } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.1 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 6, shiftVisibleRangeOnNewBar: true },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: readRgba('--kamby-ink-400', container, 0.5), style: LineStyle.Dashed },
          horzLine: { color: readRgba('--kamby-ink-400', container, 0.5), style: LineStyle.Dashed },
        },
        autoSize: true,
      });
    } catch {
      return;
    }
    const nowS = Math.floor(Date.now() / 1000);
    const seed = seedPoints(seedCandles, nowS);
    const slots = leadInSlots(seed[seed.length - 1]?.time ?? null, nowS);
    const series = chart.addSeries(AreaSeries, {
      lineColor: accent,
      lineWidth: 2,
      topColor: readRgba('--kamby-accent', container, 0.28),
      bottomColor: readRgba('--kamby-accent', container, 0.02),
      priceFormat: { type: 'price', ...pricePrecision(seedCandles.length > 0 ? seedCandles : []) },
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dashed,
      priceLineColor: accent,
      crosshairMarkerRadius: 4,
    });
    series.setData([...seed, ...slots]);
    chart.timeScale().fitContent();
    lastTimeRef.current = slots[slots.length - 1]?.time ?? seed[seed.length - 1]?.time ?? 0;
    hasPriceHistoryRef.current = seed.length > 0;
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
    // Rebuilt only for a different coin or new seed history, never per tick.
  }, [sourceKey, seedCandles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let points = 0;

    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const live = await fetchLivePrice(source);
          if (cancelled) return;
          if (live) {
            // Time must strictly increase for the series — a same-second repeat is skipped.
            const time = Math.floor(Date.now() / 1000) as UTCTimestamp;
            if (time > lastTimeRef.current && seriesRef.current) {
              // No seed history (e.g. candles briefly unavailable): size the axis decimals
              // from the live price itself, or a sub-cent coin's axis reads "0.00".
              if (!hasPriceHistoryRef.current) {
                hasPriceHistoryRef.current = true;
                const p = live.priceUsd;
                seriesRef.current.applyOptions({
                  priceFormat: { type: 'price', ...pricePrecision([{ bucketStart: '', open: p, high: p, low: p, close: p, volumeUsd: 0 }]) },
                });
              }
              seriesRef.current.update({ time, value: live.priceUsd });
              lastTimeRef.current = time;
              if (++points > MAX_POINTS) chartRef.current?.timeScale().fitContent();
            }
            setPrice(live.priceUsd);
            setStatus('live');
          }
        } catch {
          if (!cancelled) setStatus('reconnecting');
        }
      }
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-md bg-surface/80 px-2 py-1 font-mono text-[0.65rem] backdrop-blur">
        <span className={status === 'live' ? 'relative flex h-2 w-2' : 'flex h-2 w-2'}>
          {status === 'live' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />}
          <span className={`relative inline-flex h-2 w-2 rounded-full ${status === 'live' ? 'bg-up' : 'bg-ink-400'}`} />
        </span>
        <span className="uppercase tracking-wide text-ink-600">{status === 'live' ? 'Live' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>
        {price !== null && status === 'live' && <span className="tabular-nums text-ink-900">${formatLivePrice(price)}</span>}
      </div>
    </div>
  );
}

function formatLivePrice(price: number): string {
  if (price >= 1) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const { precision } = pricePrecision([{ bucketStart: '', open: price, high: price, low: price, close: price, volumeUsd: 0 }]);
  return price.toFixed(precision);
}
