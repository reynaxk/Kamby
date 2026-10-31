'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { useMyUsername } from '@/lib/use-my-username';
import { FundButton } from '@/components/wallet/FundButton';
import { markStep, readStep, START_KEYS } from '@/lib/onboarding';

/**
 * Home's first-run checklist (2026-10-31, owner: "perfect for someone's first time"): pick a
 * username, add USDC, make a first trade, look around Live and the Feed — ticks itself off,
 * can be closed, and goes away once everything's done.
 */
export function GettingStarted({ cash, holding }: { cash: number | null; holding: boolean }) {
  const t = useTranslations('start');
  const { authenticated } = usePrivy();
  const [username] = useMyUsername(authenticated);
  const [off, setOff] = useState(true);
  const [traded, setTraded] = useState(false);
  const [explored, setExplored] = useState(false);
  useEffect(() => {
    setOff(readStep(START_KEYS.dismissed));
    setTraded(readStep(START_KEYS.traded));
    setExplored(readStep(START_KEYS.explored));
  }, []);

  if (off || username === undefined || cash === null) return null;
  const steps = [
    { key: 'name', done: Boolean(username), title: t('name'), body: t('nameBody'), action: <Link href="/account" className="text-accent">{t('nameCta')} →</Link> },
    { key: 'usdc', done: cash > 0 || holding, title: t('usdc'), body: t('usdcBody'), action: <FundButton variant="pill" /> },
    { key: 'trade', done: holding || traded, title: t('trade'), body: t('tradeBody'), action: <Link href="/terminal" className="text-accent">{t('tradeCta')} →</Link> },
    { key: 'explore', done: explored, title: t('explore'), body: t('exploreBody'), action: <Link href="/live" className="text-accent">{t('exploreCta')} →</Link> },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)!;

  return (
    <section className="mt-4 rounded-2xl border border-accent/20 bg-accent/[0.04] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-sm font-extrabold text-ink-900">{t('title')}</p>
          <p className="font-body text-xs text-ink-600">{t('progress', { done, total: steps.length })}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            markStep('dismissed');
            setOff(true);
          }}
          aria-label={t('close')}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-white/[0.06]"
        >
          ✕
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 flex flex-col gap-1">
        {steps.map((s, i) => (
          <li key={s.key} className={cn('flex items-start gap-3 rounded-xl px-2 py-2', s === next && 'bg-white/[0.03]')}>
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-display text-[0.7rem] font-black',
                s.done ? 'bg-accent text-black' : 'border border-white/15 text-ink-400',
              )}
              aria-hidden
            >
              {s.done ? '✓' : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block font-display text-sm font-bold', s.done ? 'text-ink-400 line-through' : 'text-ink-900')}>{s.title}</span>
              {s === next && (
                <>
                  <span className="mt-0.5 block font-body text-xs text-ink-600">{s.body}</span>
                  <span className="mt-2 block font-display text-xs font-bold">{s.action}</span>
                </>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
