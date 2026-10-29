'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { Loader2, Zap } from 'lucide-react';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { marketHref } from '@/lib/solana-links';
import { useQuickSolanaBuy } from '@/lib/use-quick-solana-buy';

/** XXXRisk's bar sets the amount (kamby:xxxrisk-view); every ⚡ in the app buys that much. */
const VIEW_KEY = 'kamby:xxxrisk-view';
export const QUICK_AMOUNT_EVENT = 'kamby:quick-usd';
const DEFAULT_USD = 5;

function readAmount(): number {
  try {
    const v = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? '{}') as { quickUsd?: unknown };
    return typeof v.quickUsd === 'number' && v.quickUsd > 0 ? v.quickUsd : DEFAULT_USD;
  } catch {
    return DEFAULT_USD;
  }
}

function useQuickAmount(): number {
  const [usd, setUsd] = useState(DEFAULT_USD);
  useEffect(() => {
    const sync = () => setUsd(readAmount());
    sync();
    window.addEventListener(QUICK_AMOUNT_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(QUICK_AMOUNT_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return usd;
}

const PREFILL_KEY = 'kamby:quick-prefill';

/** The buy keypad a ⚡ opened starts on the ⚡ amount — once, for that coin, within a minute. */
export function takeQuickPrefill(address: string): string {
  try {
    const raw = window.sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return '';
    window.sessionStorage.removeItem(PREFILL_KEY);
    const p = JSON.parse(raw) as { address?: string; usd?: number; at?: number };
    const fresh = typeof p.at === 'number' && Date.now() - p.at < 60_000;
    return fresh && p.address?.toLowerCase() === address.toLowerCase() && typeof p.usd === 'number' ? String(p.usd) : '';
  } catch {
    return '';
  }
}

type QuickBuy = { usd: number; busy: string | null; buy: (mint: string, label: string) => void };
const QuickBuyContext = createContext<QuickBuy | null>(null);

/**
 * ⚡ on every coin row (owner 2026-10-29, "add everywhere", like GMGN): wrap a list in this and
 * each row's QuickBuyButton works. A Solana coin is bought in one tap (the same gasless path as
 * XXXRisk); a Base/BNB/Robinhood coin opens straight on its buy keypad — an EVM buy can need an
 * approval and a fee step, which belong on the coin's own screen.
 */
export function QuickBuyProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Inner>{children}</Inner>
    </ToastProvider>
  );
}

function Inner({ children }: { children: React.ReactNode }) {
  const usd = useQuickAmount();
  const quick = useQuickSolanaBuy(usd);
  const value = useMemo<QuickBuy>(() => ({ usd, busy: quick.busy, buy: (mint, label) => void quick.buy(mint, label) }), [usd, quick]);
  return <QuickBuyContext.Provider value={value}>{children}</QuickBuyContext.Provider>;
}

/** Nothing outside a QuickBuyProvider, so a row can always render it. */
type ButtonProps = { chainIdentifier: string; address: string; label: string; className?: string };
export function QuickBuyButton(props: ButtonProps) {
  const quick = useContext(QuickBuyContext);
  return quick ? <Button {...props} quick={quick} /> : null;
}

function Button({ chainIdentifier, address, label, className, quick }: ButtonProps & { quick: QuickBuy }) {
  const router = useRouter();
  const t = useTranslations('xxxrisk');
  const solana = chainIdentifier.toLowerCase() === 'solana';
  const href = marketHref(chainIdentifier, address);
  if (!solana && !href) return null;
  const buying = quick.busy === address;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (solana) quick.buy(address, label);
        else {
          try {
            window.sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ address, usd: quick.usd, at: Date.now() }));
          } catch {
            // the keypad just starts empty
          }
          router.push(`${href}${href!.includes('?') ? '&' : '?'}buy=1`);
        }
      }}
      disabled={buying}
      aria-label={t('quickBuy', { usd: quick.usd })}
      className={cn(
        'flex h-8 shrink-0 items-center gap-0.5 rounded-xl border border-accent/40 bg-accent/10 px-2 font-display text-[0.75rem] font-extrabold tabular-nums text-accent transition-colors hover:bg-accent hover:text-black active:scale-[0.97] disabled:opacity-60',
        className,
      )}
    >
      {buying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" fill="currentColor" aria-hidden />}
      {buying ? null : `$${quick.usd}`}
    </button>
  );
}
