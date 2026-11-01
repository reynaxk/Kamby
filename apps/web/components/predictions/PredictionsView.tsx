'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PREDICTION_CATEGORIES, PREDICTION_LIMITS, type Prediction, type PredictionCategory, type PredictionFilter, type PredictionsPage } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { Skeleton } from '@/components/market/Skeleton';
import { friendlyError } from '@/lib/friendly-error';
import { createPrediction, fetchPredictions, subscribePredictions } from '@/lib/predictions-client';
import { PredictionCard } from './PredictionCard';

const FILTERS: PredictionFilter[] = ['all', 'ending', 'popular', 'streamers', 'mine'];

/** Exported for tests. Folds a live update into the list (counts, outcome); unknown ids are ignored. */
export function applyUpdate(list: Prediction[], u: { id: string; counts: number[]; total: number; status?: Prediction['status']; resolvedOptionIndex?: number | null }): Prediction[] {
  return list.map((p) =>
    p.id === u.id
      ? { ...p, counts: u.counts, total: u.total, ...(u.status && { status: u.status }), ...(u.resolvedOptionIndex !== undefined && { resolvedOptionIndex: u.resolvedOptionIndex }) }
      : p,
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">
      <p className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-0.5 font-display text-xl font-extrabold tabular-nums text-ink-900">{value}</p>
    </div>
  );
}

function AskSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: Prediction) => void }) {
  const t = useTranslations('predictions');
  const [title, setTitle] = useState('');
  const [options, setOptions] = useState(['Yes', 'No']);
  const [minutes, setMinutes] = useState<number>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createPrediction({ title, options: options.filter((o) => o.trim()), minutes }));
      setTitle('');
      setOptions(['Yes', 'No']);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none';
  return (
    <MobileDrawer open={open} onClose={onClose} title={t('ask')} desktop>
      <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, PREDICTION_LIMITS.titleMax))} placeholder={t('askPlaceholder')} className={field} />
      <div className="mt-3 flex flex-col gap-2">
        {options.map((o, i) => (
          <div key={i} className="flex gap-2">
            <input value={o} onChange={(e) => setOptions((cur) => cur.map((x, j) => (j === i ? e.target.value.slice(0, PREDICTION_LIMITS.optionMax) : x)))} placeholder={t('answer', { n: i + 1 })} className={field} />
            {options.length > PREDICTION_LIMITS.minOptions && (
              <button type="button" onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))} aria-label={t('removeAnswer')} className="shrink-0 rounded-xl border border-line px-3 text-ink-400 hover:text-ink-900">
                ×
              </button>
            )}
          </div>
        ))}
        {options.length < PREDICTION_LIMITS.maxOptions && (
          <button type="button" onClick={() => setOptions((cur) => [...cur, ''])} className="self-start font-display text-xs font-bold text-accent">
            + {t('addAnswer')}
          </button>
        )}
      </div>
      <div className="mt-3 flex gap-1.5">
        {PREDICTION_LIMITS.durations.map((m) => (
          <button key={m} type="button" onClick={() => setMinutes(m)} aria-pressed={minutes === m} className={cn('h-9 flex-1 rounded-full border font-display text-xs font-bold', minutes === m ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line text-ink-600')}>
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
      </div>
      {error && <p className="mt-3 font-body text-xs text-down">{error}</p>}
      <button type="button" onClick={() => void submit()} disabled={busy || !title.trim()} className="mt-4 h-12 w-full rounded-2xl bg-accent font-display text-base font-black text-black disabled:opacity-40">
        {busy ? '…' : t('askSubmit')}
      </button>
      <p className="mt-2 text-center font-body text-[0.7rem] text-ink-400">{t('justForFun')}</p>
    </MobileDrawer>
  );
}

/** The Predictions page: today's numbers, filters, categories, and the polls — live. */
export function PredictionsView() {
  const t = useTranslations('predictions');
  const [filter, setFilter] = useState<PredictionFilter>('all');
  const [category, setCategory] = useState<PredictionCategory | undefined>(undefined);
  const [page, setPage] = useState<PredictionsPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPage(null);
    setFailed(false);
    fetchPredictions({ filter, category })
      .then((p) => !cancelled && setPage(p))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [filter, category]);

  useEffect(
    () =>
      subscribePredictions({
        onUpdate: (u) => setPage((cur) => (cur ? { ...cur, items: applyUpdate(cur.items, u) } : cur)),
        onCreated: (p) => setPage((cur) => (cur && (filter === 'all' || (filter === 'streamers' && p.live)) && (!category || p.category === category) && !cur.items.some((x) => x.id === p.id) ? { ...cur, items: [p, ...cur.items] } : cur)),
      }),
    [filter, category],
  );

  const replace = useCallback((next: Prediction) => setPage((cur) => (cur ? { ...cur, items: cur.items.map((p) => (p.id === next.id ? next : p)) } : cur)), []);

  const sentinel = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<() => void>(() => undefined);
  moreRef.current = () => void more();
  // Endless list (2026-11-01): the next page loads as the bottom comes near — no button.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && moreRef.current(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [page?.nextBefore]);

  async function more() {
    if (!page?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchPredictions({ filter, category, before: page.nextBefore });
      setPage((cur) => (cur ? { ...cur, items: [...cur.items, ...next.items.filter((p) => !cur.items.some((x) => x.id === p.id))], nextBefore: next.nextBefore } : next));
    } catch {
      // the next scroll tries again
    } finally {
      setLoadingMore(false);
    }
  }

  const chip = (on: boolean) => cn('h-9 shrink-0 rounded-full border px-3.5 font-display text-xs font-bold transition-colors', on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface text-ink-600 hover:text-ink-900');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <Stat label={t('statVotes')} value={page ? page.stats.votesToday : '—'} />
        <Stat label={t('statOpen')} value={page ? page.stats.active : '—'} />
        <Stat label={t('statMine')} value={page ? page.stats.myVotes : '—'} />
      </div>
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={t('title')} className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={chip(filter === f)}>
              {t(`filter_${f}`)}
            </button>
          ))}
        </div>
        {page?.canCreate && (
          <button type="button" onClick={() => setAsking(true)} className="h-9 shrink-0 rounded-full bg-accent px-4 font-display text-xs font-black text-black">
            + {t('ask')}
          </button>
        )}
      </div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <button type="button" onClick={() => setCategory(undefined)} aria-pressed={!category} className={chip(!category)}>
          {t('cat_all')}
        </button>
        {PREDICTION_CATEGORIES.map((c) => (
          <button key={c} type="button" onClick={() => setCategory(c)} aria-pressed={category === c} className={chip(category === c)}>
            {t(`cat_${c}`)}
          </button>
        ))}
      </div>

      {failed ? (
        <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center font-body text-sm text-ink-400">{t('failed')}</p>
      ) : page === null ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-56 rounded-2xl" />
          ))}
        </div>
      ) : page.items.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center font-body text-sm text-ink-400">{filter === 'mine' ? t('emptyMine') : t('empty')}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {page.items.map((p) => (
            <PredictionCard key={p.id} p={p} onChange={replace} />
          ))}
        </div>
      )}
      {page?.nextBefore && (
        <div ref={sentinel} aria-hidden className="grid gap-3 md:grid-cols-2">
          {loadingMore && [0, 1].map((i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}
        </div>
      )}
      <p className="font-body text-xs leading-relaxed text-ink-400">{t('justForFun')}</p>
      <AskSheet open={asking} onClose={() => setAsking(false)} onCreated={(p) => setPage((cur) => (cur && !cur.items.some((x) => x.id === p.id) ? { ...cur, items: [p, ...cur.items] } : cur))} />
    </div>
  );
}
