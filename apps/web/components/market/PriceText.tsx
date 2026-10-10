'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@kamby/ui';
import { formatPrice } from '@/lib/format';

/** How many zeros follow "0." before the first real digit (0.0000034 → 5). */
export function leadingZeros(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 0.1) return 0;
  return Math.floor(-Math.log10(abs));
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';

/** The same short form as plain text for a chart axis (canvas can't draw <sub>): 0.0₅343.
 *  Prices with fewer than 4 zeros keep `precision` decimals. */
export function axisPrice(price: number, precision: number): string {
  if (price < 0) return '';
  const zeros = leadingZeros(price);
  if (price === 0 || zeros < 4) return price.toFixed(precision);
  const digits = Math.round(price * 10 ** (zeros + 3)).toString().replace(/0+$/, '') || '0';
  const sub = String(zeros).split('').map((d) => SUBSCRIPT[Number(d)]).join('');
  return `0.0${sub}${digits}`;
}

/**
 * A price the way trading apps write it (2026-10-10): tiny meme-coin prices with the zero count
 * as a subscript — $0.0₅3410 instead of $0.00000341, which nobody can count at a glance —
 * and, with `flash`, a brief green/red light when it moves.
 */
export function PriceText({ value, flash = false, className }: { value: number | null; flash?: boolean; className?: string }) {
  const prev = useRef(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (!flash || value === null || before === null || value === before) return;
    setDir(value > before ? 'up' : 'down');
    const timer = setTimeout(() => setDir(null), 700);
    return () => clearTimeout(timer);
  }, [value, flash]);

  let zeros = value !== null && Number.isFinite(value) ? leadingZeros(value) : 0;
  let scaled = value !== null && zeros >= 4 ? Math.round(Math.abs(value) * 10 ** (zeros + 4)) : 0;
  if (scaled >= 10_000) {
    // Rounded up to the next power of ten (0.0000099999 → 0.00001): one zero fewer.
    zeros -= 1;
    scaled = 1000;
  }
  const tone = cn('transition-colors duration-500', className);
  // Inline so the flash wins over whatever text colour the caller set.
  const style = dir ? { color: `rgb(var(--kamby-${dir}))` } : undefined;
  if (value === null || zeros < 4) return <span className={tone} style={style}>{formatPrice(value)}</span>;
  // Four significant digits after the zeros, trailing zeros trimmed.
  const digits = scaled.toString().replace(/0+$/, '') || '0';
  return (
    <span className={tone} style={style} aria-label={formatPrice(value)}>
      {value < 0 ? '-' : ''}$0.0<sub className="text-[0.6em] font-semibold">{zeros}</sub>
      {digits}
    </span>
  );
}
