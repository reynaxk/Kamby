'use client';

import type { ReferralSummaryDto } from '@kamby/domain';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { ShareButton } from '@/components/social/ShareButton';
import { fetchMyReferralSummary } from '@/lib/referrals-client';
import { useTranslations } from 'next-intl';

type State = 'loading' | 'loaded' | 'error';

/**
 * Phase 7 — see docs/REFERRALS.md. Deliberately never shows a "no session" gate the way
 * WatchlistView does: every visitor gets a referral code the moment any session exists,
 * which `fetchMyReferralSummary` (via authedFetch) mints transparently on first call — see
 * lib/referrals-client.ts.
 */
export function ReferralsView() {
  const tL = useTranslations('labels');
  const tU = useTranslations('ui');
  const [state, setState] = useState<State>('loading');
  const [summary, setSummary] = useState<ReferralSummaryDto | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchMyReferralSummary()
      .then((result) => {
        setSummary(result);
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    );
  }
  if (state === 'error' || !summary) {
    return <EmptyState title={tU('couldnTLoadYourReferral_09c7')} detail="Try again in a moment." />;
  }

  const referralUrl = `${window.location.origin}/?ref=${summary.referralCode}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard unavailable/denied — the code is still shown to copy by hand
    }
  }

  const earned = Number(summary.earnedUsdcAmountFormatted);
  const earnedText = Number.isFinite(earned) ? `$${earned.toFixed(2)}` : summary.earnedUsdcAmountFormatted;
  const stat = (label: string, value: string, path: string, hint?: string) => (
    <div className="kamby-glass relative rounded-3xl p-4" title={hint}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={path} />
        </svg>
      </span>
      <p className="mt-3 font-body text-xs text-ink-400">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-black tabular-nums tracking-tight text-ink-900">{value}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* The invite card (2026-10-18 redesign: link in a field with Copy built in, Share beside it) */}
      <div className="kamby-glass relative overflow-hidden rounded-3xl p-5" style={{ background: 'linear-gradient(150deg, rgb(var(--kamby-accent) / 0.12) 0%, #0E1430 42%, #090C1A 100%)' }}>
        <svg aria-hidden className="pointer-events-none absolute -right-10 -top-10" width="190" height="190" viewBox="0 0 512 512">
          <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
            <path d="M186 140 V372" />
            <path d="M200 268 L338 140" />
            <path d="M232 246 L346 372" />
          </g>
        </svg>
        <p className="relative font-display text-lg font-black tracking-tight text-ink-900">{tU('yourReferralLink_9360')}</p>
        <p className="relative mt-1 max-w-md font-body text-xs leading-snug text-ink-400">{tL('referralsPitch')}</p>
        <div className="relative mt-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 pl-3.5">
          <span className="min-w-0 flex-1 truncate font-body text-sm text-ink-900">{referralUrl}</span>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 font-display text-sm font-bold text-black transition-transform active:scale-95"
          >
            {copied ? (
              <>
                <span aria-hidden>✓ </span>
                {tU('copied_6d6d')}
              </>
            ) : (
              tU('copyLink_b758')
            )}
          </button>
          <ShareButton title={tU('tradeWithMeOnKamby_e79f')} path={`/?ref=${summary.referralCode}`} className="shrink-0" />
        </div>
      </div>

      {/* How it works */}
      <ol className="kamby-glass relative grid gap-3 rounded-3xl p-4 sm:grid-cols-3">
        {[tL('referStep1'), tL('referStep2'), tL('referStep3')].map((step, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] font-display text-xs font-black text-accent">{i + 1}</span>
            <span className="pt-1 font-body text-sm leading-snug text-ink-600">{step}</span>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-3">
        {stat(tU('referred_8c0c'), String(summary.referredCount), 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8')}
        {stat(tU('earnedUsdc_2187'), earnedText, 'M12 3v18M16.5 7.5c-.6-1.3-2.2-2-4.5-2-2.6 0-4 1.2-4 2.8 0 4 9 2 9 6 0 1.7-1.6 3-4.5 3-2.3 0-4-.8-4.7-2.3', tU('onlyCountsTradesWhoseFee_9593'))}
      </div>
    </div>
  );
}
