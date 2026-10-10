'use client';

import type { ReferralSummaryDto } from '@kamby/domain';
import { Button, Surface } from '@kamby/ui';
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

  return (
    <div className="flex flex-col gap-4">
      <Surface className="flex flex-col gap-3 p-5">
        <p className="font-body text-sm text-ink-600">{tU('yourReferralLink_9360')}</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-raised px-3 py-2 font-mono text-sm text-ink-900">
            {referralUrl}
          </code>
          <ShareButton title={tU('tradeWithMeOnKamby_e79f')} path={`/?ref=${summary.referralCode}`} />
        </div>
        <Button type="button" variant="secondary" onClick={() => void copyLink()} className="self-start">
          {copied ? tU('copied_6d6d') : tU('copyLink_b758')}
        </Button>
        <p className="font-body text-xs text-ink-400">
          Anyone who trades after signing up through this link earns you 20% of Kamby&apos;s platform fee on
          their trades — paid out periodically, tracked here in real time.
        </p>
      </Surface>

      <div className="grid grid-cols-2 gap-3">
        <Surface className="p-4">
          <p className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">{tU('referred_8c0c')}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900">{summary.referredCount}</p>
        </Surface>
        <Surface className="p-4" title={tU('onlyCountsTradesWhoseFee_9593')}>
          <p className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">{tU('earnedUsdc_2187')}</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink-900">
            {summary.earnedUsdcAmountFormatted}
          </p>
        </Surface>
      </div>
    </div>
  );
}
