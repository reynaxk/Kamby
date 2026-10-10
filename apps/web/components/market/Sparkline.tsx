import { priceDirection } from '@/lib/format';
import { useTranslations } from 'next-intl';

const PAD = 2;

/** Renders nothing (not a flat fake line) when there isn't enough real history to draw.
 *  `width`/`height` default to the original standalone size; `SelectableTokenRow` passes a
 *  compact variant to fit its narrow terminal-sidebar row. */
export function Sparkline({ closes, width = 96, height = 32 }: { closes: number[]; width?: number; height?: number }) {
  const tU = useTranslations('ui');
  if (closes.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex shrink-0 items-center justify-center font-mono text-[0.6rem] text-ink-400"
      >
        no history
      </div>
    );
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const stepX = (width - PAD * 2) / (closes.length - 1);

  const points = closes.map((value, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (1 - (value - min) / range) * (height - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const direction = priceDirection(closes[closes.length - 1]! - closes[0]!);
  const strokeClass = direction === 'up' ? 'stroke-up' : direction === 'down' ? 'stroke-down' : 'stroke-ink-400';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0 overflow-visible" role="img" aria-label={tU('priceTrend_dc32')}>
      <polyline points={points.join(' ')} fill="none" className={strokeClass} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
