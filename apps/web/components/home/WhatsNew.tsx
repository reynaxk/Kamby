'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { Zap } from 'lucide-react';
import { usePrivy } from '@privy-io/react-auth';

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
      <style>{CSS}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full flex-col overflow-hidden bg-[#06080F] md:h-[560px] md:max-w-[920px] md:flex-row md:rounded-[28px] md:border md:border-white/[0.08]"
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

/* ——— the pictures ——— */

function IntroArt() {
  const t = useTranslations('whatsNew');
  const chips = [
    { icon: '⚡', label: t('chip1') },
    { icon: '🐋', label: t('chip2') },
    { icon: '📈', label: t('chip3') },
    { icon: '💬', label: t('chip4') },
  ];
  return (
    <div className="flex flex-col items-center">
      <div className="kw-float relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG */}
        <img src="/brand/kamby-mark.svg" alt="" className="h-28 w-28 md:h-32 md:w-32" />
        <span className="kw-badge absolute -right-3 -top-2 rounded-full bg-accent px-2 py-0.5 font-display text-[0.65rem] font-black text-black">NEW</span>
      </div>
      <div className="mt-8 grid w-full grid-cols-2 gap-2">
        {chips.map((c, n) => (
          <span key={c.label} className="kw-pop flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5" style={{ animationDelay: `${150 + n * 120}ms` }}>
            <span className="text-lg leading-none">{c.icon}</span>
            <span className="truncate font-display text-[0.8rem] font-bold text-white">{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function CoinRow({ icon, sym, sub, right, className }: { icon: string; sym: string; sub: string; right: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-[#0D1120] px-3.5 py-3', className)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] font-display text-sm font-black text-white">{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate font-display text-[0.95rem] font-bold text-white">{sym}</span>
        <span className="block truncate font-body text-xs text-white/45">{sub}</span>
      </span>
      {right}
    </div>
  );
}

function QuickBuyArt() {
  return (
    <div className="relative">
      <CoinRow icon="🐸" sym="$PEPE" sub="$12.4M MC · +18%" right={<span className="font-display text-sm font-bold tabular-nums text-up">+18%</span>} className="scale-[0.94] bg-[#0A0D18]" />
      <div className="relative mt-2">
        <CoinRow
          icon="K"
          sym="$KAMBY"
          sub="$4.2M MC · +38%"
          right={
            <span className="kw-zap relative flex h-10 items-center gap-1 rounded-xl border border-accent/50 bg-accent/10 px-3 font-display text-sm font-extrabold text-accent">
              <Zap className="h-4 w-4" fill="currentColor" aria-hidden />
              $5
            </span>
          }
          className="border-accent/30"
        />
        {/* the finger */}
        <span className="kw-finger pointer-events-none absolute right-4 top-6 text-3xl" aria-hidden>
          👆
        </span>
      </div>
      <CoinRow icon="🐶" sym="$WIF" sub="$910K MC · +12%" right={<span className="font-display text-sm font-bold tabular-nums text-up">+12%</span>} className="mt-2 scale-[0.94] bg-[#0A0D18]" />
      <div className="kw-toast absolute inset-x-4 -bottom-14 flex items-center gap-2 rounded-2xl bg-accent px-4 py-3 font-display text-sm font-black text-black">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/15">✓</span>
        $5 · $KAMBY
        <span className="ml-auto font-body text-xs font-bold">0.4s</span>
      </div>
    </div>
  );
}

const WHALES: [string, string, string, string, boolean][] = [
  ['🐋', '0x7a…91', '$BRETT', '$12.4K', true],
  ['🦈', '9fQ…kp', '$WIF', '$3.1K', false],
  ['🐋', '0xbe…4f', '$ZKK', '$8.8K', true],
  ['🐟', 'Gh2…x9', '$BONK', '$940', true],
  ['🦈', '0x51…7f', '$AERO', '$2.2K', false],
  ['🐋', '4yf…h8u', '$JUP', '$15.0K', true],
];

function WhalesArt() {
  const rows = [...WHALES, ...WHALES];
  return (
    <div className="relative h-[300px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]">
      <div className="kw-marquee space-y-2">
        {rows.map(([icon, who, coin, usd, buy], n) => (
          <CoinRow
            key={n}
            icon={icon}
            sym={who}
            sub={`${buy ? '▲' : '▼'} ${coin}`}
            right={
              <span className="flex items-center gap-2">
                <span className={cn('rounded-lg px-2 py-1 font-display text-sm font-black tabular-nums', buy ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>{usd}</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 font-display text-sm text-white/70">+</span>
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}

function useCountUp(to: number, ms = 1400) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return v;
}

function RecordArt() {
  const tL = useTranslations('labels');
  const rate = useCountUp(64);
  const best = useCountUp(332);
  const days = [1, 1, 0, -1, 1, 1, 0, 1, -1, 1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, -1];
  return (
    <div className="rounded-3xl border border-white/[0.07] bg-[#0D1120] p-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="font-body text-xs text-white/45">{tL('winRate')}</p>
          <p className="font-display text-5xl font-black tabular-nums leading-none text-up">{rate}%</p>
        </div>
        <div className="text-right">
          <p className="font-body text-xs text-white/45">{tL('bestTrade')}</p>
          <p className="font-display text-2xl font-black tabular-nums text-up">+{best}%</p>
        </div>
      </div>
      <div className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
        {[
          ['bg-up', 4],
          ['bg-up/45', 12],
          ['bg-down/45', 7],
          ['bg-down', 2],
        ].map(([cls, g], n) => (
          <span key={n} className={cn('kw-grow origin-left', cls as string)} style={{ flexGrow: g as number, animationDelay: `${n * 120}ms` }} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5">
        {days.map((v, n) => (
          <span
            key={n}
            className={cn('kw-pop flex h-7 items-center justify-center rounded-md font-body text-[0.6rem] font-bold tabular-nums', v > 0 ? 'bg-up/40 text-up' : v < 0 ? 'bg-down/40 text-down' : 'bg-white/[0.05] text-white/25')}
            style={{ animationDelay: `${300 + n * 35}ms` }}
          >
            {n + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function ChatArt() {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="kw-pop self-center rounded-full border border-[#A78BFA]/30 bg-[#A78BFA]/10 px-3 py-1 font-display text-xs font-bold text-[#C4B5FD]" style={{ animationDelay: '0ms' }}>
        # degen-lounge · 128 online
      </span>
      <Bubble who="🐋" side="l" delay={250}>
        aped $KAMBY at 2M 🚀
      </Bubble>
      <Bubble side="r" delay={900}>
        copying you 👀
      </Bubble>
      <Bubble who="🦈" side="l" delay={1550}>
        <span className="flex items-center gap-2">
          <span className="rounded-lg bg-up/15 px-1.5 py-0.5 font-display text-xs font-black text-up">+$420</span> sold half 💰
        </span>
      </Bubble>
      <span className="kw-pop flex items-center gap-1 self-start rounded-2xl rounded-bl-md bg-white/[0.07] px-3.5 py-3" style={{ animationDelay: '2200ms' }}>
        <span className="kw-dot h-1.5 w-1.5 rounded-full bg-white/60" />
        <span className="kw-dot h-1.5 w-1.5 rounded-full bg-white/60" style={{ animationDelay: '150ms' }} />
        <span className="kw-dot h-1.5 w-1.5 rounded-full bg-white/60" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
}

function Bubble({ who, side, delay, children }: { who?: string; side: 'l' | 'r'; delay: number; children: ReactNode }) {
  return (
    <span className={cn('kw-pop flex items-end gap-2', side === 'r' ? 'flex-row-reverse self-end' : 'self-start')} style={{ animationDelay: `${delay}ms` }}>
      {who && <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-sm">{who}</span>}
      <span
        className={cn(
          'max-w-[230px] rounded-2xl px-3.5 py-2.5 font-body text-sm',
          side === 'r' ? 'rounded-br-md bg-[#A78BFA] font-semibold text-black' : 'rounded-bl-md bg-white/[0.07] text-white',
        )}
      >
        {children}
      </span>
    </span>
  );
}

/* Transform-only motion (owner rule: nothing fades in from invisible; no glow, no blur). */
const CSS = `
.kw-fill{animation-name:kw-fill;animation-timing-function:linear;animation-fill-mode:forwards;transform:scaleX(0)}
@keyframes kw-fill{to{transform:scaleX(1)}}
.kw-grid{background-image:linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px);background-size:36px 36px;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 20%,transparent 70%);mask-image:radial-gradient(circle at 50% 50%,#000 20%,transparent 70%);animation:kw-pan 14s linear infinite}
@keyframes kw-pan{to{background-position:36px 36px}}
.kw-stage{background:radial-gradient(120% 80% at 50% 0%,color-mix(in srgb,var(--kw-tone) 14%,transparent),transparent 60%)}
.kw-orbit{border-color:color-mix(in srgb,var(--kw-tone) 22%,transparent);animation:kw-spin 40s linear infinite}
@keyframes kw-spin{to{transform:translate(-50%,-50%) rotate(360deg)}}
.kw-in{animation:kw-in .55s cubic-bezier(.2,.9,.25,1.1)}
@keyframes kw-in{from{transform:translateY(18px) scale(.96)}to{transform:none}}
.kw-up{animation:kw-up .5s cubic-bezier(.2,.9,.25,1)}
@keyframes kw-up{from{transform:translateY(10px)}to{transform:none}}
.kw-pop{animation:kw-pop .45s cubic-bezier(.3,1.5,.5,1) both}
@keyframes kw-pop{from{transform:scale(.6)}to{transform:scale(1)}}
.kw-float{animation:kw-float 4s ease-in-out infinite}
@keyframes kw-float{50%{transform:translateY(-8px) rotate(-3deg)}}
.kw-badge{animation:kw-wiggle 2.4s ease-in-out infinite}
@keyframes kw-wiggle{0%,70%,100%{transform:rotate(0)}80%{transform:rotate(-12deg)}90%{transform:rotate(10deg)}}
.kw-finger{animation:kw-finger 2.6s ease-in-out infinite}
@keyframes kw-finger{0%{transform:translate(30px,40px)}35%{transform:translate(-6px,4px)}45%{transform:translate(-6px,4px) scale(.85)}55%{transform:translate(-6px,4px)}100%{transform:translate(30px,40px)}}
.kw-zap{animation:kw-zap 2.6s ease-in-out infinite}
@keyframes kw-zap{0%,40%,60%,100%{transform:scale(1)}45%{transform:scale(.9);background:#00FF87;color:#000}}
.kw-toast{animation:kw-toast 2.6s ease-in-out infinite}
@keyframes kw-toast{0%,44%{transform:translateY(90px)}54%,88%{transform:translateY(0)}100%{transform:translateY(90px)}}
.kw-marquee{animation:kw-marquee 9s linear infinite}
@keyframes kw-marquee{to{transform:translateY(-50%)}}
.kw-grow{animation:kw-grow .9s cubic-bezier(.2,.9,.25,1) both}
@keyframes kw-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.kw-dot{animation:kw-dot 1s ease-in-out infinite}
@keyframes kw-dot{50%{transform:translateY(-4px)}}
@media (prefers-reduced-motion: reduce){.kw-root *:not(.kw-fill){animation-duration:1ms!important;animation-iteration-count:1!important}.kw-fill{animation:none!important;transform:scaleX(.5)}}
`;
