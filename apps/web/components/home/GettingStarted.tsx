'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { cn } from '@kamby/ui';
import { useMyUsername } from '@/lib/use-my-username';
import { FundButton } from '@/components/wallet/FundButton';
import { markStep, readStep, START_KEYS } from '@/lib/onboarding';

/**
 * Home's first-run checklist (2026-10-31, owner: "perfect for someone's first time"): pick a
 * username, add USDC, make a first trade, look around Live and the Feed — ticks itself off,
 * can be closed, and goes away once everything's done. Since 2026-11-01 (tidy pass) it's one slim
 * row — progress, the next step and its action — that opens into the full list on tap.
 */
export function GettingStarted({ cash, holding }: { cash: number | null; holding: boolean }) {
  const t = useTranslations('start');
  const { authenticated } = usePrivy();
  const [username] = useMyUsername(authenticated);
  const [off, setOff] = useState(true);
  const [traded, setTraded] = useState(false);
  const [explored, setExplored] = useState(false);
  const [open, setOpen] = useState(false);
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
    <section className="mt-4 rounded-2xl border border-accent/20 bg-accent/[0.04] px-3.5 py-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span aria-hidden className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-display text-[0.7rem] font-black text-accent" style={{ background: `conic-gradient(#00FF87 ${(done / steps.length) * 360}deg, rgba(255,255,255,0.08) 0)` }}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg">{done}/{steps.length}</span>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-body text-[0.7rem] text-ink-600">{t('title')}</span>
            <span className="block truncate font-display text-sm font-bold text-ink-900">{next.title}</span>
          </span>
          <ChevronDown aria-hidden className={cn('h-4 w-4 shrink-0 text-ink-400 transition-transform', open && 'rotate-180')} />
        </button>
        {/* Phones: the step name gets the room; the action is one tap away inside (2026-11-01). */}
        {!open && <span className="hidden shrink-0 font-display text-xs font-bold sm:inline">{next.action}</span>}
        <button
          type="button"
          onClick={() => {
            markStep('dismissed');
            setOff(true);
          }}
          aria-label={t('close')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-white/[0.06]"
        >
          ✕
        </button>
      </div>
      {open && (
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
      )}
    </section>
  );
}
