'use client';

import { cn } from '@kamby/ui';

/**
 * Opt-in gas-sponsorship toggle — see docs/GAS_RELAYER_PLAN.md and
 * `SolanaQuoteService#createSponsoredQuote`'s own doc comment (backend) for the full
 * picture. Off (the default) behaves exactly as this flow always has: your own wallet pays
 * its own network fee, unchanged. On, Kamby's own relayer pays the network fee instead —
 * you sign only your own required slot, never a second signature for the fee itself. Mutually
 * exclusive with the Jito tip control (both change how/who broadcasts): a sponsored
 * transaction always broadcasts via the relayer's own RPC call, never through Jito, so
 * SolanaTradePanel hides JitoTipControl whenever this is on rather than showing a control
 * that would silently do nothing.
 *
 * This may show a real error (e.g. "Gas sponsorship is not enabled on this deployment") on
 * a deployment where the relayer isn't turned on yet — that's an honest, already-handled
 * quote-error state (see quoteStatus === 'error' in SolanaTradePanel), not a broken toggle;
 * simply turn it back off to trade normally.
 */
export function GaslessToggle({ value, onChange }: { value: boolean; onChange: (gasless: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      className={cn(
        'flex w-full items-center justify-between rounded-lg border px-3 py-2 font-body text-xs transition-colors',
        value ? 'border-accent bg-accent/15 text-accent' : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
      )}
    >
      <span className="uppercase tracking-wide">Gasless (no SOL needed)</span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          value ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            value ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  );
}
