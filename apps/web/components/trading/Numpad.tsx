'use client';

import { cn } from '@kamby/ui';

export type NumpadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

const KEYS: NumpadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Exported for tests. The typed amount after one key — dollars and cents, at most 7 digits
 *  before the point, no leading zeros ("05" → "5"), one point. */
export function applyNumpadKey(text: string, key: NumpadKey, maxDecimals = 2): string {
  if (key === 'back') return text.slice(0, -1);
  if (key === '.') {
    if (text.includes('.') || maxDecimals === 0) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  const [whole = '', frac] = text.split('.');
  if (frac !== undefined) return frac.length >= maxDecimals ? text : `${text}${key}`;
  if (whole === '0') return key;
  if (whole.length >= 7) return text;
  return `${text}${key}`;
}

/**
 * The phone buy sheet's keypad (2026-10-28, owner: "like GMGN but better"): big keys under a
 * big amount, so a buy never waits for the phone's own keyboard to slide up.
 */
export function Numpad({ onKey, className }: { onKey: (key: NumpadKey) => void; className?: string }) {
  return (
    <div className={cn('grid grid-cols-3 gap-1', className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-label={key === 'back' ? 'Delete' : key}
          onClick={() => onKey(key)}
          className="flex h-[3.4rem] items-center justify-center rounded-2xl font-display text-[1.6rem] font-semibold text-ink-900 transition-colors active:bg-white/[0.08]"
        >
          {key === 'back' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
              <path d="m17 9-5 6M12 9l5 6" />
            </svg>
          ) : (
            key
          )}
        </button>
      ))}
    </div>
  );
}
