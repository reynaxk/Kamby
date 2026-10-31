'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Prediction, ProfilePredictions } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchProfilePredictions } from '@/lib/predictions-client';
import { PredictionCard } from './PredictionCard';

/**
 * A trader profile's Predictions tab (2026-10-31): their hit rate (votes that matched the
 * outcome, out of resolved ones — a plain stat, nothing to win), the polls they asked, and the
 * ones they voted on with their answer.
 */
export function ProfilePredictionsTab({ address }: { address: string }) {
  const t = useTranslations('predictions');
  const [data, setData] = useState<ProfilePredictions | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchProfilePredictions(address)
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [address]);

  const replace = (next: Prediction) =>
    setData((cur) =>
      cur
        ? {
            ...cur,
            created: cur.created.map((p) => (p.id === next.id ? next : p)),
            voted: cur.voted.map((p) => (p.id === next.id ? { ...next, theirVote: p.theirVote } : p)),
          }
        : cur,
    );

  if (failed) return <p className="py-6 text-center font-body text-sm text-ink-400">{t('failed')}</p>;
  if (!data) return <Skeleton className="h-48 rounded-2xl" />;

  const { stats } = data;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2">
        {[
          [t('profileAccuracy'), stats.accuracyPct === null ? '—' : `${stats.accuracyPct}%`],
          [t('profileRight'), `${stats.correct}/${stats.resolved}`],
          [t('profileVotes'), String(stats.votes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <p className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</p>
            <p className="mt-0.5 font-display text-xl font-extrabold tabular-nums text-ink-900">{value}</p>
          </div>
        ))}
      </div>
      {data.created.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-sm font-bold text-ink-900">{t('profileAsked')}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {data.created.map((p) => (
              <PredictionCard key={p.id} p={p} onChange={replace} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="mb-2 font-display text-sm font-bold text-ink-900">{t('profileVoted')}</h3>
        {data.voted.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-6 text-center font-body text-sm text-ink-400">{t('profileNone')}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data.voted.map((p) => {
              const right = p.resolvedOptionIndex === null ? null : p.resolvedOptionIndex === p.theirVote;
              return (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <p className={cn('px-1 font-display text-xs font-bold', right === null ? 'text-ink-600' : right ? 'text-up' : 'text-down')}>
                    {right === null ? '•' : right ? '✓' : '✗'} {t('profiletheirVote', { answer: p.options[p.theirVote] ?? '' })}
                  </p>
                  <PredictionCard p={p} onChange={replace} />
                </div>
              );
            })}
          </div>
        )}
      </section>
      <p className="font-body text-xs text-ink-400">{t('justForFun')}</p>
    </div>
  );
}
