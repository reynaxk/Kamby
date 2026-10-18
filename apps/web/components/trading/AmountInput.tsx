'use client';

import { cn } from '@kamby/ui';
import { formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import { useTranslations } from 'next-intl';
import { formatTradeAmount } from '@/lib/format';

const PRESET_FRACTIONS = [0.25, 0.5, 1] as const;

/**
 * Amount presets are fractions of the connected wallet's *real* balance of the input token
 * for this side (read live from-chain via wagmi, never assumed) — never a fixed dollar
 * amount, since Kamby doesn't have a live USD conversion input here and a hardcoded
 * "$10/$50/$100" would be meaningless for an 18-decimal token priced at a fraction of a
 * cent. See docs/TRADING.md#trading-ui.
 */
export function AmountInput({
  value,
  onChange,
  inputTokenAddress,
  inputTokenSymbol,
  inputTokenDecimals,
  className,
  hero = false,
  usdBalance = null,
}: {
  value: string;
  onChange: (value: string) => void;
  inputTokenAddress: string;
  inputTokenSymbol: string | null;
  inputTokenDecimals: number;
  className?: string;
  /** Phone trade sheet (2026-10-10): the amount big and centred, like an app's keypad screen. */
  hero?: boolean;
  /** A buy in dollars (2026-10-18, one balance line): `shown` is the whole USDC balance across
   *  chains, `spendable` what one buy can reach (this chain + one move); the presets use it. */
  usdBalance?: { shown: number; spendable: number } | null;
}) {
  const tTrade = useTranslations('trade');
  const { address } = useAccount();
  const { data: balance } = useBalance({
    address,
    token: inputTokenAddress as `0x${string}`,
    query: { refetchInterval: 15_000 },
  });

  const applyFraction = (fraction: number) => {
    if (usdBalance) {
      onChange((Math.floor(usdBalance.spendable * fraction * 100) / 100).toFixed(2));
      return;
    }
    if (!balance) return;
    const raw = (balance.value * BigInt(Math.round(fraction * 10_000))) / 10_000n;
    onChange(formatUnits(raw, inputTokenDecimals));
  };

  return (
    <div className={className}>
      <div className={cn('flex items-center font-body text-xs text-ink-600', hero ? 'justify-center' : 'justify-between')}>
        {!hero && <span>{tTrade('amountOf', { symbol: inputTokenSymbol ?? 'token' })}</span>}
        {usdBalance ? (
          <span>
            {tTrade('balance')} ${usdBalance.shown.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        ) : (
          balance && (
            <span>
              {tTrade('balance')}{' '}
              {inputTokenSymbol === 'USDC'
                ? `$${Number(formatUnits(balance.value, inputTokenDecimals)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : formatTradeAmount(Number(formatUnits(balance.value, inputTokenDecimals)))}
            </span>
          )
        )}
      </div>
      {hero && (
        <div className="flex items-baseline justify-center py-4 font-display font-bold text-ink-900">
          {inputTokenSymbol === 'USDC' && <span className={cn('text-5xl', !value && 'text-ink-400')}>$</span>}
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            aria-label={tTrade('amountOf', { symbol: inputTokenSymbol ?? 'token' })}
            value={value}
            style={{ width: `${Math.max(1, value.length) + 0.15}ch` }}
            onChange={(event) => {
              const raw = event.target.value;
              if (raw === '' || /^\d*\.?\d*$/.test(raw)) onChange(raw);
            }}
            className="min-w-[1ch] max-w-full bg-transparent text-center text-5xl tabular-nums placeholder:text-ink-400 focus:outline-none"
          />
          {inputTokenSymbol !== 'USDC' && <span className="ml-2 text-xl text-ink-400">{inputTokenSymbol}</span>}
        </div>
      )}
      {!hero && (
      <input
        type="text"
        inputMode="decimal"
        placeholder="0.0"
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '' || /^\d*\.?\d*$/.test(raw)) onChange(raw);
        }}
        className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-lg text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      )}
      <div className="mt-1.5 flex gap-1.5">
        {PRESET_FRACTIONS.map((fraction) => (
          <button
            key={fraction}
            type="button"
            disabled={usdBalance ? !(usdBalance.spendable > 0) : !balance || balance.value === 0n}
            onClick={() => applyFraction(fraction)}
            className={cn(
              'flex-1 rounded-lg bg-surface-raised px-2 py-1.5 font-body text-xs font-medium text-ink-600',
              hero && 'rounded-full py-2.5 text-sm font-semibold text-ink-900',
              'hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {fraction === 1 ? tTrade('max') : `${fraction * 100}%`}
          </button>
        ))}
      </div>
    </div>
  );
}
