'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@kamby/ui';
import { solanaConnection } from '@/lib/solana-config';

type PingState = { status: 'checking' } | { status: 'ok'; ms: number } | { status: 'down' };

/**
 * A real, measured round-trip to the actual configured Solana RPC (`getSlot` — one of the
 * cheapest possible calls) — not a decorative static number. Addresses the "slow RPC
 * feedback" friction point named for this redesign honestly: if the RPC is slow, this bar
 * shows a slow number, it never shows a reassuring number that isn't true. Deliberately
 * does not show a Jito tip or an Anti-MEV toggle here — Kamby has no Jito integration to
 * back either one yet (see docs/TRADING.md#solana); inventing a plausible-looking value for
 * something not actually happening would be worse than showing nothing.
 */
export function RpcStatusBar() {
  const [ping, setPing] = useState<PingState>({ status: 'checking' });

  useEffect(() => {
    if (!solanaConnection) {
      setPing({ status: 'down' });
      return;
    }
    let cancelled = false;

    async function check() {
      const startedAt = performance.now();
      try {
        await solanaConnection!.getSlot();
        if (!cancelled) setPing({ status: 'ok', ms: Math.round(performance.now() - startedAt) });
      } catch {
        if (!cancelled) setPing({ status: 'down' });
      }
    }

    void check();
    const interval = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const color = ping.status === 'down' ? 'text-down' : ping.status === 'ok' && ping.ms > 400 ? 'text-warn' : 'text-up';

  return (
    <div className="flex items-center gap-1.5 font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">
      <Activity className={cn('h-3 w-3', color)} />
      {ping.status === 'checking' && <span>Connecting…</span>}
      {ping.status === 'ok' && (
        <span>
          RPC <span className={color}>{ping.ms}ms</span>
        </span>
      )}
      {ping.status === 'down' && <span className={color}>RPC unreachable</span>}
    </div>
  );
}
