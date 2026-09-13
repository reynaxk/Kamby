'use client';

import { cn } from '@kamby/ui';

export const JITO_TIP_PRESETS = [
  { label: 'Off', lamports: 0 },
  { label: 'Low', lamports: 1_000_000 }, // 0.001 SOL
  { label: 'Medium', lamports: 5_000_000 }, // 0.005 SOL
  { label: 'High', lamports: 10_000_000 }, // 0.01 SOL
] as const;

/**
 * Opt-in Jito tip / priority-broadcast selector — see JupiterQuoteService's own doc comment
 * (backend) and SolanaTradePanel's Jito broadcast branch (this trade actually routing
 * through Jito's Block Engine instead of the normal RPC) for the full picture. "Off" (the
 * default) behaves exactly as this flow always has: no tip, normal RPC broadcast. Any other
 * choice adds a real SOL cost the user's own wallet pays on top of the swap itself — never
 * hidden, the exact lamports amount is always shown.
 */
export function JitoTipControl({ valueLamports, onChange }: { valueLamports: number; onChange: (lamports: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between font-body text-xs text-ink-600">
        <span className="uppercase tracking-wide">Priority (Jito tip)</span>
        {valueLamports > 0 && <span className="font-mono text-ink-900">{(valueLamports / 1_000_000_000).toFixed(3)} SOL</span>}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {JITO_TIP_PRESETS.map((preset) => {
          const isActive = valueLamports === preset.lamports;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => onChange(preset.lamports)}
              className={cn(
                'flex-1 rounded-full border px-2 py-1.5 font-mono text-xs font-semibold transition-colors',
                isActive
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
