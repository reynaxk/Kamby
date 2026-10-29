'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { Zap } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

/** Bump when there's a new round to show — everyone who saw the last one sees this once. */
const VERSION = '2026-10-29';
const SEEN_KEY = 'kamby:whats-new';

/**
 * "Kamby just updated" (2026-10-29, owner: like GMGN's update pop-up — right after you sign in,
 * before the terminal): a few slides of what's new, Back / Next / Got it, once per VERSION per
 * browser. Mounted app-wide; only for a signed-in person. A sheet on phones, a centered card
 * on computers.
 */
export function WhatsNew() {
  const t = useTranslations('whatsNew');
  const { ready, authenticated } = usePrivy();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!ready || !authenticated) return;
    try {
      if (window.localStorage.getItem(SEEN_KEY) !== VERSION) setOpen(true);
    } catch {
      // No storage (private window) — never nag on every visit.
    }
  }, [ready, authenticated]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function close() {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, VERSION);
    } catch {
      // fine — it just shows again next time
    }
  }

  if (!open) return null;
  const slides: { art: ReactNode; title: string; body: string }[] = [
    { art: <QuickBuyArt />, title: t('s1Title'), body: t('s1Body') },
    { art: <WhalesArt />, title: t('s2Title'), body: t('s2Body') },
    { art: <RecordArt />, title: t('s3Title'), body: t('s3Body') },
    { art: <ChatArt />, title: t('s4Title'), body: t('s4Body') },
  ];
  const last = i === slides.length - 1;
  const slide = slides[i]!;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 md:items-center" onClick={close} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl border border-white/[0.08] bg-[#0B0E17] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-3xl md:pb-5"
      >
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-body text-xs font-semibold text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {t('title')}
            <span className="tabular-nums text-ink-400">· {i + 1}/{slides.length}</span>
          </span>
          <button type="button" onClick={close} className="font-body text-xs font-semibold text-ink-400 hover:text-ink-900">
            {t('skip')}
          </button>
        </div>

        <div onClick={() => !last && setI(i + 1)} className="mt-4 flex h-44 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-white/[0.06] bg-[linear-gradient(160deg,#0E1430_0%,#090C1A_60%,#05070A_100%)] px-5">
          {slide.art}
        </div>
        <h2 className="mt-5 font-display text-xl font-black tracking-tight text-ink-900">{slide.title}</h2>
        <p className="mt-1.5 min-h-[3.75rem] font-body text-sm leading-relaxed text-ink-400">{slide.body}</p>

        <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
          {slides.map((_, n) => (
            <span key={n} className={cn('h-1.5 rounded-full transition-all', n === i ? 'w-5 bg-accent' : 'w-1.5 bg-white/20')} />
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="h-12 flex-1 rounded-2xl bg-white/[0.06] font-display text-sm font-bold text-ink-900 active:scale-[0.98]">
              {t('back')}
            </button>
          )}
          <button
            type="button"
            onClick={() => (last ? close() : setI(i + 1))}
            className="h-12 flex-[2] rounded-2xl bg-accent font-display text-sm font-bold text-black active:scale-[0.98]"
          >
            {last ? t('done') : t('next')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Little drawings of each feature, built from the app's own pieces (no screenshots to go stale). */

function Row({ icon, sym, sub, right }: { icon: string; sym: string; sub: string; right: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 font-display text-xs font-black text-accent">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block font-display text-sm font-bold text-ink-900">{sym}</span>
        <span className="block font-body text-[0.68rem] text-ink-400">{sub}</span>
      </span>
      {right}
    </div>
  );
}

function Zap5() {
  return (
    <span className="flex h-8 shrink-0 items-center gap-0.5 rounded-xl border border-accent/40 bg-accent/10 px-2 font-display text-xs font-extrabold text-accent">
      <Zap className="h-3.5 w-3.5" fill="currentColor" aria-hidden />
      $5
    </span>
  );
}

function QuickBuyArt() {
  return (
    <div className="w-full space-y-2">
      <Row icon="K" sym="$KAMBY" sub="$4.2M MC · +38%" right={<Zap5 />} />
      <Row icon="W" sym="$WHALE" sub="$910K MC · +12%" right={<Zap5 />} />
    </div>
  );
}

function WhalesArt() {
  return (
    <div className="w-full space-y-2">
      <Row icon="🐋" sym="0x7a…91" sub="bought $BRETT" right={<span className="font-display text-sm font-black tabular-nums text-up">$12.4K</span>} />
      <Row icon="🦈" sym="9fQ…kp" sub="sold $WIF" right={<span className="font-display text-sm font-black tabular-nums text-down">$3.1K</span>} />
    </div>
  );
}

function RecordArt() {
  return (
    <div className="w-full">
      <div className="flex items-end justify-between">
        <span className="font-display text-4xl font-black tabular-nums text-up">64%</span>
        <span className="font-body text-xs font-semibold tabular-nums text-ink-400">
          <span className="text-up">16W</span> / <span className="text-down">9L</span>
        </span>
      </div>
      <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full">
        <span className="bg-up" style={{ flexGrow: 4 }} />
        <span className="bg-up/45" style={{ flexGrow: 12 }} />
        <span className="bg-down/45" style={{ flexGrow: 7 }} />
        <span className="bg-down" style={{ flexGrow: 2 }} />
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {[1, 0, -1, 1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1].map((v, n) => (
          <span key={n} className={cn('h-4 rounded', v > 0 ? 'bg-up/50' : v < 0 ? 'bg-down/50' : 'bg-white/[0.06]')} />
        ))}
      </div>
    </div>
  );
}

function ChatArt() {
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="max-w-[75%] self-start rounded-2xl rounded-bl-md bg-white/[0.07] px-3 py-2 font-body text-sm text-ink-900">aped $KAMBY 🚀</span>
      <span className="max-w-[75%] self-end rounded-2xl rounded-br-md bg-accent px-3 py-2 font-body text-sm font-semibold text-black">copying you 👀</span>
      <span className="self-start rounded-full border border-accent/25 bg-accent/[0.08] px-2.5 py-1 font-display text-xs font-bold text-accent"># degen-lounge</span>
    </div>
  );
}
