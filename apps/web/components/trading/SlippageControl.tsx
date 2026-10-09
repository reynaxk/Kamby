'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { isValidSlippageBps, TRADING_DEFAULTS } from '@kamby/domain';
import { useTranslations } from 'next-intl';

const PRESETS_BPS = [10, 50, 100]; // 0.1% / 0.5% / 1%

/** Exported for tests. "Auto" slippage: ~2× the quote's price impact plus 0.5%, kept within
 *  1–5% — tight for liquid coins, enough room that thin memecoin trades don't keep failing.
 *  1% before any quote exists. */
export function autoSlippageBps(priceImpactBps: number | null | undefined, volatile = false): number {
  // Brand-new and bonding-curve coins can move 10% between quote and send — at 1–5% their
  // trades kept failing Jupiter's slippage check (error 6001, 2026-10-05). They get 5–15%.
  const [floor, cap] = volatile ? [500, 1500] : [100, 500];
  if (priceImpactBps === null || priceImpactBps === undefined) return floor;
  return Math.min(cap, Math.max(floor, Math.round((2 * priceImpactBps + 50) / 10) * 10));
}

function formatBpsAsPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
}

/**
 * Explicit slippage control — see docs/TRADING.md#slippage. Presets cover the common
 * cases; "Custom" is clamped to the same [minSlippageBps, maxSlippageBps] bounds the API
 * itself enforces (see QuoteQueryDto), so a user can never even attempt an unsafe value —
 * there is no way to submit an "unlimited slippage" request from this UI.
 */
export function SlippageControl({
  valueBps,
  onChange,
  className,
  auto,
}: {
  valueBps: number;
  onChange: (bps: number) => void;
  className?: string;
  /** The "Auto" option — `active` when the panel is using autoSlippageBps. */
  auto?: { active: boolean; onSelect: () => void };
}) {
  const tTrade = useTranslations('trade');
  const isPreset = PRESETS_BPS.includes(valueBps);
  const [customOpen, setCustomOpen] = useState(!isPreset && !auto?.active);
  const [customInput, setCustomInput] = useState(isPreset ? '' : (valueBps / 100).toString());
  // Previously: an out-of-range or malformed custom value was silently ignored — `onChange`
  // just never fired, so the trade still used whatever the last *valid* value was while the
  // input box kept showing the rejected text, with nothing telling the user the two had
  // diverged. Now tracked explicitly so that mismatch is always visible rather than silent.
  const [customError, setCustomError] = useState<string | null>(null);

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="font-body text-xs text-ink-600">{tTrade('slippage')}</span>
        <span className="font-mono text-xs text-ink-600">
          {auto?.active ? `${tTrade('auto')} · ${formatBpsAsPercent(valueBps)}` : formatBpsAsPercent(valueBps)}
        </span>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {auto && (
          <button
            type="button"
            onClick={() => {
              setCustomOpen(false);
              setCustomError(null);
              auto.onSelect();
            }}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-medium transition-colors',
              auto.active ? 'bg-accent text-accent-ink' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
            )}
          >
            {tTrade('auto')}
          </button>
        )}
        {PRESETS_BPS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setCustomOpen(false);
              setCustomError(null);
              onChange(preset);
            }}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-medium transition-colors',
              !customOpen && !auto?.active && valueBps === preset ? 'bg-accent text-accent-ink' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
            )}
          >
            {formatBpsAsPercent(preset)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className={cn(
            'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-medium transition-colors',
            customOpen ? 'bg-accent text-accent-ink' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
          )}
        >
          {tTrade('custom')}
        </button>
      </div>
      {customOpen && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            type="text"
            inputMode="decimal"
            value={customInput}
            placeholder={`${TRADING_DEFAULTS.minSlippageBps / 100}–${TRADING_DEFAULTS.maxSlippageBps / 100}`}
            onChange={(event) => {
              const raw = event.target.value;
              setCustomInput(raw);
              const percent = Number.parseFloat(raw);
              const bps = Number.isFinite(percent) ? Math.round(percent * 100) : null;
              if (bps !== null && isValidSlippageBps(bps)) {
                setCustomError(null);
                onChange(bps);
              } else {
                // Never call onChange for an invalid value — the last valid slippage stays
                // in effect for the actual trade — but say so, rather than leaving the
                // input showing text that silently doesn't match what will be used.
                setCustomError(
                  raw.trim() === ''
                    ? `Enter a value between ${TRADING_DEFAULTS.minSlippageBps / 100}% and ${TRADING_DEFAULTS.maxSlippageBps / 100}%`
                    : `Must be between ${TRADING_DEFAULTS.minSlippageBps / 100}% and ${TRADING_DEFAULTS.maxSlippageBps / 100}% — still using ${formatBpsAsPercent(valueBps)}`,
                );
              }
            }}
            aria-invalid={customError !== null}
            className={cn(
              'w-full rounded-lg border bg-bg px-2 py-1.5 font-mono text-xs text-ink-900 focus:outline-none focus:ring-1',
              customError ? 'border-down focus:ring-down' : 'border-line focus:ring-accent',
            )}
          />
          <span className="font-body text-xs text-ink-600">%</span>
        </div>
      )}
      {customError && <p className="mt-1 font-body text-xs text-down">{customError}</p>}
      {/* A UI-only heuristic (not a server-enforced threshold) — the API's actual bound is
          TRADING_DEFAULTS.maxSlippageBps, enforced regardless of this warning. */}
      {valueBps >= 300 && (
        <p className="mt-1 font-body text-xs text-down">A high slippage tolerance can expose this trade to sandwich attacks.</p>
      )}
    </div>
  );
}
