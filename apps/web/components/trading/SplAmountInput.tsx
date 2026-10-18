'use client';

import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { formatUnits, parseUnits } from 'viem';
import { Wallet } from 'lucide-react';
import { cn } from '@kamby/ui';
import { GlowValue } from '@/components/market/GlowValue';
import { solanaConnection } from '@/lib/solana-config';
import { formatTokenAmount } from '@/lib/solana-mint';
import { useTranslations } from 'next-intl';

const PERCENT_PRESETS = [25, 50, 100] as const;

/**
 * SELL-side amount input for an SPL token (BONK, WIF, ...) — SolAmountInput's counterpart
 * for everything that isn't native SOL. `value` is raw units of `mint`, same contract as
 * SolAmountInput; the text field is in whole tokens, converted with the mint's real
 * decimals (see useMintDecimals), never a float multiply. No fee reserve: selling an SPL
 * token never spends that token on network fees. Percentage presets instead of fixed
 * amounts, since a fixed "1000" means wildly different values across tokens.
 */
export function SplAmountInput({
  value,
  onChange,
  walletAddress,
  mint,
  symbol,
  decimals,
  hero = false,
  onBalance,
}: {
  value: string;
  onChange: (value: string) => void;
  walletAddress: string | undefined;
  mint: string;
  symbol: string | null;
  decimals: number | null;
  /** Phone trade sheet (2026-10-10): the amount big and centred. */
  hero?: boolean;
  /** Reports the coin balance (raw) so the panel can stop a sell above it. */
  onBalance?: (raw: bigint | null) => void;
}) {
  const tTrade = useTranslations('trade');
  const [balanceRaw, setBalanceRaw] = useState<bigint | null>(null);
  const [text, setText] = useState('');
  useEffect(() => onBalance?.(balanceRaw), [balanceRaw, onBalance]);

  useEffect(() => {
    setBalanceRaw(null);
    if (!walletAddress || !solanaConnection) return;
    let cancelled = false;
    void (async () => {
      try {
        const { value: accounts } = await solanaConnection!.getParsedTokenAccountsByOwner(
          new PublicKey(walletAddress),
          { mint: new PublicKey(mint) },
          'confirmed',
        );
        const total = accounts.reduce((sum, a) => sum + BigInt(a.account.data.parsed?.info?.tokenAmount?.amount ?? '0'), 0n);
        if (!cancelled) setBalanceRaw(total);
      } catch {
        if (!cancelled) setBalanceRaw(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, mint]);

  // Keep the text field in sync when the parent resets or a preset sets the raw value.
  useEffect(() => {
    if (value === '') setText('');
    else if (decimals !== null) {
      try {
        if (parseUnits(text || '0', decimals).toString() !== value) setText(formatUnits(BigInt(value), decimals));
      } catch {
        setText(formatUnits(BigInt(value), decimals));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reacts to external value changes
  }, [value, decimals]);

  const applyPercent = (percent: number) => {
    if (balanceRaw === null || balanceRaw === 0n) return;
    const raw = (balanceRaw * BigInt(percent)) / 100n;
    onChange(raw > 0n ? raw.toString() : '');
  };

  const label = symbol ?? 'tokens';

  return (
    <div>
      <div className={cn('flex items-center font-body text-xs text-ink-600', hero ? 'justify-center' : 'justify-between')}>
        {!hero && <span className="uppercase tracking-wide">{tTrade('amountOf', { symbol: label })}</span>}
        {balanceRaw !== null && (
          <span className="inline-flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            {tTrade('balance')}{' '}
            <GlowValue value={balanceRaw.toString()} display={formatTokenAmount(balanceRaw.toString(), decimals, symbol)} className="font-mono" />
          </span>
        )}
      </div>
      <input
        type="text"
        inputMode="decimal"
        placeholder="0"
        disabled={decimals === null}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== '' && !/^\d*\.?\d*$/.test(next)) return;
          setText(next);
          if (next === '' || next === '.' || decimals === null) {
            onChange('');
            return;
          }
          try {
            const raw = parseUnits(next, decimals);
            onChange(raw > 0n ? raw.toString() : '');
          } catch {
            // More fractional digits than the mint supports — leave the last valid amount.
          }
        }}
        aria-label={tTrade('amountOf', { symbol: label })}
        className={cn(
          'mt-1 w-full rounded-xl border border-line bg-bg px-3 py-3 font-mono text-2xl font-semibold text-ink-900 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50',
          hero && 'border-0 bg-transparent py-4 text-center font-display text-5xl font-bold placeholder:text-ink-400 focus:ring-0',
        )}
      />
      {hero && <p className="-mt-1 text-center font-body text-sm text-ink-400">{label}</p>}
      <div className="mt-1.5 flex gap-1.5">
        {PERCENT_PRESETS.map((percent) => (
          <button
            key={percent}
            type="button"
            disabled={balanceRaw === null || balanceRaw === 0n}
            onClick={() => applyPercent(percent)}
            className={cn(
              'flex-1 rounded-full border border-line bg-surface-raised px-2 py-1.5 font-mono text-xs font-semibold text-ink-600',
              hero && 'py-2.5 text-sm',
              'hover:border-accent/60 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {percent === 100 ? tTrade('max') : `${percent}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
