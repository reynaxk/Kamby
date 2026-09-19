'use client';

import { useEffect, useState } from 'react';
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { Wallet } from 'lucide-react';
import { SOLANA_USDC_MINT } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { GlowValue } from '@/components/market/GlowValue';
import { solanaConnection } from '@/lib/solana-config';

export const USD_PRESETS = [10, 25, 50, 100] as const;
const USDC_DECIMALS = 6;

/** Shared with the mobile speed dock (SolanaTradePanel) so the $ → raw-USDC conversion
 *  lives in exactly one place. */
export function usdToRawUsdc(dollars: number): string {
  return (dollars * 10 ** USDC_DECIMALS).toString();
}

/**
 * The 1-tap preset row for Solana's BUY flow — see docs/TRADING.md#solana. Unlike
 * AmountInput.tsx's percentage-of-balance presets (needed there because an arbitrary
 * token has no live USD conversion), these map directly to raw USDC amounts —
 * `$10 → 10_000_000` (USDC's 6 decimals) — no price oracle involved, since USDC is
 * definitionally $1 and is always this flow's fixed input token. Only "100%" needs a live
 * read, of the wallet's actual USDC Associated Token Account balance.
 */
export function UsdPresetAmountInput({
  value,
  onChange,
  walletAddress,
}: {
  value: string;
  onChange: (value: string) => void;
  walletAddress: string | undefined;
}) {
  const [usdcBalanceRaw, setUsdcBalanceRaw] = useState<bigint | null>(null);

  useEffect(() => {
    setUsdcBalanceRaw(null);
    if (!walletAddress || !solanaConnection) return;
    let cancelled = false;

    async function loadBalance() {
      try {
        const owner = new PublicKey(walletAddress!);
        const ata = await getAssociatedTokenAddress(new PublicKey(SOLANA_USDC_MINT), owner);
        const account = await getAccount(solanaConnection!, ata);
        if (!cancelled) setUsdcBalanceRaw(account.amount);
      } catch (error) {
        // No USDC ATA yet (a wallet that has never held USDC) is a real, honest zero
        // balance, not an error to surface — every other failure (RPC unreachable, etc.)
        // just leaves the balance unknown, never a fabricated number.
        if (!cancelled) setUsdcBalanceRaw(error instanceof TokenAccountNotFoundError ? 0n : null);
      }
    }
    void loadBalance();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  const applyUsd = (dollars: number) => {
    onChange(usdToRawUsdc(dollars));
  };

  const applyMax = () => {
    if (usdcBalanceRaw === null) return;
    onChange(usdcBalanceRaw.toString());
  };

  return (
    <div>
      <div className="flex items-center justify-between font-body text-xs text-ink-600">
        <span className="uppercase tracking-wide">Amount (USDC)</span>
        {usdcBalanceRaw !== null && (
          <span className="inline-flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            Balance:{' '}
            <GlowValue
              value={usdcBalanceRaw.toString()}
              display={`$${(Number(usdcBalanceRaw) / 10 ** USDC_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
              className="font-mono"
            />
          </span>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        value={value ? (Number(value) / 10 ** USDC_DECIMALS).toString() : ''}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange('');
          } else if (/^\d*\.?\d*$/.test(raw)) {
            onChange(Math.round(Number(raw) * 10 ** USDC_DECIMALS).toString());
          }
        }}
        className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3 font-mono text-2xl font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent"
      />
      <div className="mt-1.5 flex gap-1.5">
        {USD_PRESETS.map((dollars) => {
          const isActive = value === usdToRawUsdc(dollars);
          return (
            <button
              key={dollars}
              type="button"
              onClick={() => applyUsd(dollars)}
              className={cn(
                'flex-1 rounded-full border px-2 py-1.5 font-mono text-xs font-semibold transition-colors',
                isActive
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
              )}
            >
              ${dollars}
            </button>
          );
        })}
        <button
          type="button"
          disabled={usdcBalanceRaw === null || usdcBalanceRaw === 0n}
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
