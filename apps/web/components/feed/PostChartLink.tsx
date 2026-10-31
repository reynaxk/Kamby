'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';

/** "Post this chart" (2026-10-31): opens the Feed composer with this coin's chart attached. */
export function postChartHref(chainIdentifier: string, tokenAddress: string, symbol: string | null): string {
  const q = new URLSearchParams({ chart: `${chainIdentifier}:${tokenAddress}` });
  if (symbol) q.set('symbol', symbol);
  return `/feed?${q.toString()}`;
}

export function PostChartLink({ chainIdentifier, tokenAddress, symbol, round = false, className }: { chainIdentifier: string; tokenAddress: string; symbol: string | null; round?: boolean; className?: string }) {
  const t = useTranslations('feed');
  return (
    <Link
      href={postChartHref(chainIdentifier, tokenAddress, symbol)}
      aria-label={t('postChart')}
      title={t('postChart')}
      className={cn(
        round
          ? 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10'
          : 'flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 font-display text-xs font-bold text-ink-700 transition-colors hover:border-white/20 hover:text-ink-900',
        className,
      )}
    >
      <svg width={round ? 20 : 15} height={round ? 20 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 3v18h18" />
        <path d="m7 15 4-4 3 3 5-6" />
      </svg>
      {!round && t('postChart')}
    </Link>
  );
}
