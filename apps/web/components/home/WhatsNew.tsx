'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { usePrivy } from '@privy-io/react-auth';
import { ChatArt, IntroArt, QuickBuyArt, RecordArt, SceneStyles, WhalesArt } from '@/components/landing/LiveScenes';

/** Bump when there's a new round to show — everyone who saw the last one sees this once. */
const VERSION = '2026-10-29b';
const SEEN_KEY = 'kamby:whats-new';
const SLIDE_MS = 6500;

/**
 * "Kamby just updated" (2026-10-29, owner: a trailer like GMGN's update pop-up, right after you
 * sign in, before the terminal — "aesthetic and interactive, tap NEXT"). Story-style: segments
 * fill on their own, tap right / left to skip, hold to pause, arrows and Esc on a keyboard.
 * Every picture is alive (transform-only loops — nothing starts invisible, nothing glows).
 * Full screen on phones, a wide card on computers. Once per VERSION per browser.
 */
export function WhatsNew() {
  const t = useTranslations('whatsNew');
  const { ready, authenticated } = usePrivy();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== VERSION) setOpen(true);
    } catch {
      // No storage (private window) — never nag on every visit.
    }
  }, [ready, authenticated]);

  const close = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, VERSION);
    } catch {
      // fine — it just shows again next time
    }
  }, []);

  const slides: { tag: string; title: string; body: string; art: ReactNode; tone: string }[] = [
    { tag: t('title'), title: t('introTitle'), body: t('introBody'), art: <IntroArt />, tone: '#00FF87' },
    { tag: '01', title: t('s1Title'), body: t('s1Body'), art: <QuickBuyArt />, tone: '#00FF87' },
    { tag: '02', title: t('s2Title'), body: t('s2Body'), art: <WhalesArt />, tone: '#38BDF8' },
    { tag: '03', title: t('s3Title'), body: t('s3Body'), art: <RecordArt key={i} />, tone: '#FACC15' },
    { tag: '04', title: t('s4Title'), body: t('s4Body'), art: <ChatArt key={i} />, tone: '#A78BFA' },
  ];
  const last = i === slides.length - 1;
  const next = useCallback(() => (last ? close() : setI((n) => n + 1)), [last, close]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' || e.key === ' ') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, next, back]);

  if (!open) return null;
  const slide = slides[i]!;

  return (
    <div className="kw-root fixed inset-0 z-[80] flex items-stretch justify-center bg-black/80 md:items-center md:p-6" role="presentation" onClick={close}>
      <SceneStyles />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full flex-col overflow-hidden bg-[#030305] md:h-[560px] md:max-w-[920px] md:flex-row md:rounded-[28px] md:border md:border-white/[0.08]"
        style={{ ['--kw-tone' as string]: slide.tone }}
      >
        {/* Story segments — the current one fills; when it's full the next slide plays. */}
        <div className="absolute inset-x-0 top-0 z-20 flex gap-1 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:px-6 md:pt-5">
          {slides.map((_, n) => (
            <span key={n} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/15">
              <span
                key={n === i ? `on-${i}` : 'off'}
                className={cn('block h-full origin-left rounded-full bg-white', n < i ? 'scale-x-100' : n > i ? 'scale-x-0' : 'kw-fill')}
                style={n === i ? { animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' } : undefined}
                onAnimationEnd={n === i ? next : undefined}
              />
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={t('skip')}
          className="absolute right-3 top-[calc(env(safe-area-inset-top)+1.6rem)] z-20 rounded-full bg-white/10 px-3 py-1 font-body text-xs font-semibold text-white/80 hover:bg-white/20 md:right-5 md:top-9"
        >
          {t('skip')}
        </button>

        {/* The picture — tap the right side for next, the left for back, hold to pause. */}
        <div
          className="kw-stage relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden px-6 pt-16 md:h-full md:w-[52%] md:flex-none md:pt-10"
          onPointerDown={() => setPaused(true)}
          onPointerUp={(e) => {
            setPaused(false);
            const r = e.currentTarget.getBoundingClientRect();
            if (e.clientX - r.left < r.width / 3) back();
            else next();
          }}
          onPointerLeave={() => setPaused(false)}
        >
          <div className="kw-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="kw-orbit pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed" aria-hidden />
          <div key={i} className="kw-in relative w-full max-w-[340px]">
            {slide.art}
          </div>
        </div>

        <div className="relative flex flex-col px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 md:flex-1 md:justify-center md:border-l md:border-white/[0.06] md:px-10 md:pb-10">
          <span className="font-display text-xs font-black uppercase tracking-[0.2em]" style={{ color: slide.tone }}>
            {slide.tag}
          </span>
          <h2 key={`h${i}`} className="kw-up mt-2 font-display text-[1.85rem] font-black leading-[1.05] tracking-tight text-white md:text-[2.4rem]">
            {slide.title}
          </h2>
          <p key={`p${i}`} className="kw-up mt-3 font-body text-[0.95rem] leading-relaxed text-white/60 md:text-base">
            {slide.body}
          </p>
          <div className="mt-6 flex gap-2 md:mt-10">
            {i > 0 && (
              <button type="button" onClick={back} className="h-14 w-24 shrink-0 rounded-2xl bg-white/[0.07] font-display text-sm font-bold text-white active:scale-[0.97]">
                {t('back')}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="group flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl font-display text-base font-black text-black transition-transform active:scale-[0.98]"
              style={{ background: slide.tone }}
            >
              {last ? t('cta') : i === 0 ? t('start') : t('next')}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="transition-transform group-hover:translate-x-0.5">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>
          <p className="mt-3 hidden font-body text-xs text-white/30 md:block">{t('keysHint')}</p>
        </div>
      </div>
    </div>
  );
}

