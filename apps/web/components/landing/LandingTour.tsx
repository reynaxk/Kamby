'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { ChatArt, QuickBuyArt, RecordArt, SceneStyles, WhalesArt } from './LiveScenes';

const TAB_MS = 6000;

/**
 * "See Kamby in action" (2026-10-29): the trailer's live scenes as a tour on the landing page —
 * tabs that play themselves (the active one fills, then the next starts) and stop on a click.
 */
export function LandingTour() {
  const t = useTranslations('landing');
  const tw = useTranslations('whatsNew');
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  const tabs: { icon: string; title: string; body: string; art: ReactNode; tone: string }[] = [
    { icon: '⚡', title: tw('chip1'), body: tw('s1Body'), art: <QuickBuyArt />, tone: '#00FF87' },
    { icon: '🐋', title: tw('chip2'), body: tw('s2Body'), art: <WhalesArt />, tone: '#38BDF8' },
    { icon: '📈', title: tw('chip3'), body: tw('s3Body'), art: <RecordArt key={i} />, tone: '#FACC15' },
    { icon: '💬', title: tw('chip4'), body: tw('s4Body'), art: <ChatArt key={i} />, tone: '#A78BFA' },
  ];
  const tab = tabs[i]!;

  return (
    <div>
      <SceneStyles />
      <div className="text-center">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.3em] text-[#5BE3A0]">{t('tourKicker')}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,5vw,3.2rem)] font-black leading-tight tracking-tight text-white">{t('tourTitle')}</h2>
      </div>
      <div className="mt-12 grid items-center gap-6 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
        <div role="tablist" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-col lg:overflow-visible">
          {tabs.map((x, n) => (
            <button
              key={x.title}
              type="button"
              role="tab"
              aria-selected={n === i}
              onClick={() => {
                setI(n);
                setAuto(false);
              }}
              className={cn(
                'relative shrink-0 overflow-hidden rounded-2xl border px-4 py-3 text-left transition-colors lg:px-5 lg:py-4',
                n === i ? 'border-white/15 bg-white/[0.06]' : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]',
              )}
            >
              <span className="flex items-center gap-3">
                <span className="text-xl leading-none">{x.icon}</span>
                <span className="font-display text-sm font-bold text-white lg:text-lg">{x.title}</span>
              </span>
              <span className={cn('mt-2 hidden font-body text-sm leading-relaxed text-[#94A3B8] lg:block', n !== i && 'lg:hidden')}>{x.body}</span>
              {n === i && (
                <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
                  <span
                    key={`${i}-${auto}`}
                    className={cn('block h-full origin-left', auto ? 'kw-fill' : '')}
                    style={{ background: x.tone, ...(auto ? { animationDuration: `${TAB_MS}ms` } : {}) }}
                    onAnimationEnd={() => setI((n + 1) % tabs.length)}
                  />
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          className="relative flex h-[420px] items-center justify-center overflow-hidden rounded-[2rem] border border-white/[0.08] bg-[#030305] px-6"
          style={{ background: `radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, ${tab.tone} 14%, transparent), transparent 60%), #030305` }}
        >
          <div className="kw-grid pointer-events-none absolute inset-0" aria-hidden />
          <div key={i} className="kw-in relative w-full max-w-[360px]">
            {tab.art}
          </div>
        </div>
        <p className="font-body text-sm leading-relaxed text-[#94A3B8] lg:hidden">{tab.body}</p>
      </div>
    </div>
  );
}
