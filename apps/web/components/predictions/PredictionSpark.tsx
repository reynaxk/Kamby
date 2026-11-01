'use client';

import { useEffect, useRef, useState } from 'react';
import type { Candle } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { evmChartSource, loadCandles, type ChartSource } from '@/lib/chart-data';
import { formatPercent, formatPrice } from '@/lib/format';

/** The last 6 hours of 5m candles. */
const POINTS = 72;
const W = 300;
const H = 56;

function sourceFor(chainIdentifier: string, tokenAddress: string): ChartSource | null {
  if (chainIdentifier === 'solana') return { kind: 'solana', mint: tokenAddress };
  const id = Number(chainIdentifier.split(':')[1]);
  return Number.isFinite(id) && id > 0 ? evmChartSource(tokenAddress, id) : null;
}

/** Exported for tests. The SVG path of the closes, plus the target line's y (when it fits the frame). */
export function sparkGeometry(closes: number[], target: number | null): { path: string; targetY: number | null } {
  if (closes.length < 2) return { path: '', targetY: null };
  const lo = Math.min(...closes, target ?? Infinity);
  const hi = Math.max(...closes, target ?? -Infinity);
  const span = hi - lo || hi || 1;
  const y = (v: number) => 4 + (1 - (v - lo) / span) * (H - 8);
  const path = closes.map((c, i) => `${i === 0 ? 'M' : 'L'}${((i / (closes.length - 1)) * W).toFixed(1)},${y(c).toFixed(1)}`).join(' ');
  return { path, targetY: target !== null ? y(target) : null };
}

/**
 * A coin poll's mini chart (2026-11-01): the coin's last 6 hours as a line, its price now, and the
 * poll's target as a dashed line — so you can see how far it has to go before you vote. Candles
 * load only once the card is on screen (the endless list would otherwise fetch every chart), and
 * the chart cache shares them between the several polls about one coin.
 */
export function PredictionSpark({ chainIdentifier, tokenAddress, thresholdUsd }: { chainIdentifier: string; tokenAddress: string; thresholdUsd: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [candles, setCandles] = useState<Candle[] | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const source = visible ? sourceFor(chainIdentifier, tokenAddress) : null;
    if (!source) return;
    let alive = true;
    loadCandles(source, '5m')
      .then((c) => alive && setCandles(c))
      .catch(() => alive && setCandles([]));
    return () => {
      alive = false;
    };
  }, [visible, chainIdentifier, tokenAddress]);

  const closes = (candles ?? []).slice(-POINTS).map((c) => c.close).filter((c) => c > 0);
  if (candles && closes.length < 2) return null;
  const { path, targetY } = sparkGeometry(closes, thresholdUsd);
  const now = closes.at(-1) ?? null;
  const change = now !== null && closes[0] ? (now / closes[0] - 1) * 100 : null;
  const up = (change ?? 0) >= 0;
  const toGo = now !== null && thresholdUsd ? (thresholdUsd / now - 1) * 100 : null;

  return (
    <div ref={ref} className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2 font-mono text-[0.68rem] tabular-nums">
        <span className="text-ink-900">
          {now !== null ? formatPrice(now) : '—'}
          {change !== null && <span className={cn('ml-1.5', up ? 'text-up' : 'text-down')}>{formatPercent(change)} 6h</span>}
        </span>
        {thresholdUsd !== null && (
          <span className="text-ink-400">
            🎯 {formatPrice(thresholdUsd)}
            {toGo !== null && Math.abs(toGo) >= 0.01 && ` (${formatPercent(toGo)})`}
          </span>
        )}
      </div>
      {candles === null ? (
        <div className="mt-1.5 h-14 animate-pulse rounded-lg bg-white/[0.03]" />
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1.5 h-14 w-full" aria-hidden>
          {targetY !== null && <line x1="0" x2={W} y1={targetY} y2={targetY} stroke="currentColor" strokeDasharray="4 4" strokeWidth="1" className="text-ink-400" vectorEffect="non-scaling-stroke" />}
          <path d={path} fill="none" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className={up ? 'stroke-up' : 'stroke-down'} />
        </svg>
      )}
    </div>
  );
}
