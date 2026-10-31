'use client';

import { useEffect, useRef, useState } from 'react';

const CANDLES = [
  [60, 52, 64, 50], [52, 58, 60, 49], [58, 47, 59, 45], [47, 55, 57, 44], [55, 50, 57, 48], [50, 42, 52, 40], [42, 46, 48, 39],
  [46, 38, 47, 36], [38, 41, 43, 35], [41, 33, 42, 31], [33, 36, 38, 30], [36, 28, 37, 26], [28, 31, 33, 25], [31, 22, 32, 20],
  [22, 26, 28, 19], [26, 18, 27, 16], [18, 21, 23, 15], [21, 12, 22, 10],
] as const;

/** Lines that loop through the mock chat — names and numbers only, nothing to translate. */
const LINES: { kind: 'msg' | 'trade' | 'tip'; who: string; text: string }[] = [
  { kind: 'msg', who: 'mira', text: 'lets goooo 🚀' },
  { kind: 'trade', who: 'whalejoe', text: '+$250 $WIF' },
  { kind: 'msg', who: 'degenkid', text: 'entry? 👀' },
  { kind: 'tip', who: 'satoshi_jr', text: '$25.00' },
  { kind: 'msg', who: 'shark', text: 'copied ⚡' },
  { kind: 'trade', who: 'shark', text: '+$40 $WIF' },
  { kind: 'msg', who: 'nova', text: 'GG 🔥' },
];
const EMOJIS = ['❤️', '🔥', '🚀', '💎', '👀'];

/**
 * The landing page's Live section (2026-10-31): what Kamby's streams are — watch a trader's
 * screen, see their trades land in chat, copy them, tip and react. The scene is decorative
 * (aria-hidden) and moves with transforms only; nothing starts invisible, nothing glows.
 */
export function LiveShowcase({ kicker, title, body, points }: { kicker: string; title: string; body: string; points: { icon: string; title: string; body: string }[] }) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#FF5C83]">● {kicker}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,4.5vw,3rem)] font-black leading-[1.05] tracking-tight text-white">{title}</h2>
        <p className="mt-4 max-w-md font-body text-base leading-relaxed text-[#94A3B8]">{body}</p>
        <ul className="mt-8 flex flex-col gap-4">
          {points.map((p) => (
            <li key={p.title} className="flex gap-3.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg" aria-hidden>
                {p.icon}
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-white">{p.title}</span>
                <span className="block font-body text-sm text-[#94A3B8]">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Scene />
    </div>
  );
}

function Scene() {
  const [shown, setShown] = useState(4);
  const [floats, setFloats] = useState<{ id: number; e: string; x: number }[]>([]);
  const id = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const chat = setInterval(() => setShown((n) => n + 1), 1800);
    const fl = setInterval(() => {
      const n = id.current++;
      setFloats((cur) => [...cur.slice(-10), { id: n, e: EMOJIS[n % EMOJIS.length]!, x: (n * 37) % 40 }]);
      setTimeout(() => setFloats((cur) => cur.filter((f) => f.id !== n)), 2600);
    }, 650);
    return () => {
      clearInterval(chat);
      clearInterval(fl);
    };
  }, []);
  const visible = Array.from({ length: 5 }, (_, i) => LINES[(shown - 5 + i + LINES.length * 10) % LINES.length]!);
  const tip = [...visible].reverse().find((l) => l.kind === 'tip');

  return (
    <div className="relative grid overflow-hidden rounded-3xl border border-white/10 bg-[#07080B] sm:grid-cols-[1fr_200px]" aria-hidden>
      {/* Stage */}
      <div className="relative aspect-[4/3] border-b border-white/10 bg-[#040507] sm:aspect-auto sm:min-h-[340px] sm:border-b-0 sm:border-r">
        <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
          <span className="rounded-[5px] bg-[#FF3B69] px-1.5 py-0.5 font-display text-[0.6rem] font-black tracking-wider text-white">LIVE</span>
          <span className="rounded-[5px] bg-black/80 px-1.5 py-0.5 font-mono text-[0.65rem] text-white">👁 1.2K</span>
        </div>
        <div className="absolute right-3 top-3 z-10 flex h-16 w-16 items-center justify-center rounded-xl border border-white/15 bg-[#0C0D11]">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG */}
          <img src="/brand/kamby-mark.svg" alt="" className="h-8 w-8" />
        </div>
        <svg viewBox="0 0 180 70" preserveAspectRatio="none" className="absolute inset-x-4 bottom-14 top-16 h-[calc(100%-7.5rem)] w-[calc(100%-2rem)]">
          {CANDLES.map(([o, c, h, l], i) => {
            const x = i * 10 + 5;
            const up = c < o;
            const color = up ? '#00E676' : '#FF3B69';
            return (
              <g key={i}>
                <line x1={x} x2={x} y1={l} y2={h} stroke={color} strokeWidth="0.8" />
                <rect x={x - 3} y={Math.min(o, c)} width="6" height={Math.max(1, Math.abs(o - c))} fill={color} />
              </g>
            );
          })}
        </svg>
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/80 py-1 pl-1 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFC94D]/20 font-display text-[0.6rem] font-black text-[#FFC94D]">W</span>
          <span className="font-display text-xs font-bold text-white">$WIF</span>
          <span className="font-mono text-xs text-[#00E676]">+12.4%</span>
        </div>
        <div className="pointer-events-none absolute bottom-12 right-4 z-10 h-40 w-12">
          {floats.map((f) => (
            <span key={f.id} className="kamby-float-up absolute bottom-0 text-xl" style={{ right: `${f.x}%` }}>
              {f.e}
            </span>
          ))}
        </div>
      </div>
      {/* Chat */}
      <div className="flex flex-col gap-1.5 p-3">
        {tip && (
          <div className="rounded-lg bg-[#FFB800] px-2.5 py-1.5 font-display text-[0.7rem] font-black text-black">
            💸 @{tip.who} · {tip.text}
          </div>
        )}
        <div className="mt-auto flex flex-col gap-1.5">
          {visible.map((l, i) =>
            l.kind === 'msg' ? (
              <p key={`${shown}-${i}`} className="font-body text-xs text-white/85">
                <b className="mr-1 font-display text-[#00FF87]">{l.who}</b>
                {l.text}
              </p>
            ) : (
              <p
                key={`${shown}-${i}`}
                className={
                  l.kind === 'tip'
                    ? 'self-start rounded-lg bg-[#FFB800]/15 px-2 py-0.5 font-display text-[0.68rem] font-bold text-[#FFD966]'
                    : 'self-start rounded-lg bg-[#00FF87]/10 px-2 py-0.5 font-display text-[0.68rem] font-bold text-[#00FF87]'
                }
              >
                {l.kind === 'tip' ? '💸' : '🔥'} {l.who} {l.text}
              </p>
            ),
          )}
        </div>
        <div className="mt-2 flex gap-1">
          {EMOJIS.map((e) => (
            <span key={e} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/[0.06] text-sm">
              {e}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
