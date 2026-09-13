import { Shield, Zap } from 'lucide-react';
import { RpcStatusBar } from './RpcStatusBar';

/**
 * The inline "Smart Slip & Gas" execution bar above the swap widget. RPC latency is real
 * (see RpcStatusBar). Jito tip and Anti-MEV are shown disabled/"Soon" rather than a
 * plausible-looking fake value or a toggle that does nothing when flipped — Kamby has no
 * Jito integration to back either one yet (see docs/TRADING.md#solana), and a fake number
 * next to a real one is worse than an honest placeholder.
 */
export function SmartSlipGasBar() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-line bg-surface-raised px-3 py-2">
      <RpcStatusBar />
      <span className="h-3 w-px bg-line" />
      <span className="inline-flex items-center gap-1 font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">
        <Zap className="h-3 w-3" />
        Jito tip <span className="text-ink-400">— soon</span>
      </span>
      <span className="h-3 w-px bg-line" />
      <button
        type="button"
        disabled
        title="Anti-MEV protection isn't wired up yet"
        className="ml-auto inline-flex cursor-not-allowed items-center gap-1 rounded-full border border-line px-2 py-1 font-mono text-[0.65rem] uppercase tracking-wide text-ink-400 opacity-60"
      >
        <Shield className="h-3 w-3" />
        Anti-MEV — soon
      </button>
    </div>
  );
}
