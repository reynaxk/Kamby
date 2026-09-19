'use client';

import { useEffect, useState } from 'react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { Wallet } from 'lucide-react';
import { cn } from '@kamby/ui';
import { GlowValue } from '@/components/market/GlowValue';
import { solanaConnection } from '@/lib/solana-config';

export const SOL_PRESETS = [0.01, 0.05, 0.1, 0.5] as const;

/** SOL only ever pays its own transaction's network fee after a sell — reserved off the
 *  top of "Max" so a 100%-balance sell can never leave the wallet unable to pay for the
 *  very transaction that's selling it. ~10x a typical Solana base fee, real headroom. */
const FEE_RESERVE_LAMPORTS = 10_000_000n; // 0.01 SOL

export function solToRawLamports(sol: number): string {
  return Math.round(sol * LAMPORTS_PER_SOL).toString();
}

/**
 * SELL-side counterpart to UsdPresetAmountInput — see SolanaQuoteService#resolvePlatformFeeBps's
 * own doc comment: a SELL's `amount` is raw units of `tokenMint` (SOL, 9 decimals), never
 * USDC (6 decimals). There's no oracle-free $ -> SOL conversion the way $ -> USDC is
 * trivially 1:1 on the BUY side, so this shows/accepts a SOL-denominated amount with a live
 * lamport balance instead of a USD preset row. Hardcoded to native SOL: launch scope only
 * ever sells SOL (see app/solana/page.tsx), not an arbitrary token.
 */
export function SolAmountInput({
  value,
  onChange,
  walletAddress,
}: {
  value: string;
  onChange: (value: string) => void;
  walletAddress: string | undefined;
}) {
  const [solBalanceLamports, setSolBalanceLamports] = useState<bigint | null>(null);

  useEffect(() => {
    setSolBalanceLamports(null);
    if (!walletAddress || !solanaConnection) return;
    let cancelled = false;

    async function loadBalance() {
      try {
        const owner = new PublicKey(walletAddress!);
        const lamports = await solanaConnection!.getBalance(owner, 'confirmed');
        if (!cancelled) setSolBalanceLamports(BigInt(lamports));
      } catch {
        // RPC unreachable — leave the balance unknown, never a fabricated number.
        if (!cancelled) setSolBalanceLamports(null);
      }
    }
    void loadBalance();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const applySol = (sol: number) => onChange(solToRawLamports(sol));

  const applyMax = () => {
    if (solBalanceLamports === null) return;
    const spendable = solBalanceLamports > FEE_RESERVE_LAMPORTS ? solBalanceLamports - FEE_RESERVE_LAMPORTS : 0n;
    onChange(spendable.toString());
  };

  return (
    <div>
      <div className="flex items-center justify-between font-body text-xs text-ink-600">
        <span className="uppercase tracking-wide">Amount (SOL)</span>
        {solBalanceLamports !== null && (
          <span className="inline-flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            Balance:{' '}
            <GlowValue
              value={solBalanceLamports.toString()}
              display={`${(Number(solBalanceLamports) / LAMPORTS_PER_SOL).toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`}
              className="font-mono"
            />
          </span>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        value={value ? (Number(value) / LAMPORTS_PER_SOL).toString() : ''}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange('');
          } else if (/^\d*\.?\d*$/.test(raw)) {
            onChange(solToRawLamports(Number(raw)));
          }
        }}
        className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3 font-mono text-2xl font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="mt-1.5 flex gap-1.5">
        {SOL_PRESETS.map((sol) => {
          const isActive = value === solToRawLamports(sol);
          return (
            <button
              key={sol}
              type="button"
              onClick={() => applySol(sol)}
              className={cn(
                'flex-1 rounded-full border px-2 py-1.5 font-mono text-xs font-semibold transition-colors',
                isActive
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
              )}
            >
              {sol}
            </button>
          );
        })}
        <button
          type="button"
          disabled={solBalanceLamports === null || solBalanceLamports === 0n}
          onClick={applyMax}
          className={cn(
            'flex-1 rounded-full border border-line bg-surface-raised px-2 py-1.5 font-mono text-xs font-semibold text-ink-600',
            'hover:border-accent/60 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          Max
        </button>
      </div>
    </div>
  );
}
