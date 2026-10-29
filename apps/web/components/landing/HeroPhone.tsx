'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Zap } from 'lucide-react';

const CANDLES = 26;

type Candle = { o: number; c: number; h: number; l: number };

function step(prev: number, rnd: () => number = Math.random): Candle {
  // An uptrend with real-looking pullbacks.
  const drift = 0.012;
  const c = Math.max(0.2, prev * (1 + drift + (rnd() - 0.42) * 0.06));
  const hi = Math.max(prev, c) * (1 + rnd() * 0.012);
  const lo = Math.min(prev, c) * (1 - rnd() * 0.012);
  return { o: prev, c, h: hi, l: lo };
}

/** The first frame is the same on the server and in the browser (a seeded random). */
function seed(): Candle[] {
  let a = 7;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const out: Candle[] = [];
  let p = 1;
  for (let n = 0; n < CANDLES; n++) {
    const k = step(p, rnd);
    out.push(k);
    p = k.c;
  }
  return out;
}

/**
 * The landing hero (2026-10-29, owner: "the pic looks too basic and boring"): a phone running
 * Kamby — candles print live, the price ticks, a finger taps ⚡ and the buy lands in 0.4s —
 * with the things that make Kamby different floating around it. Decorative; transform-only.
 */
export function HeroPhone() {
  const t = useTranslations('landing');
  const [candles, setCandles] = useState<Candle[]>(() => seed());
  useEffect(() => {
    const id = setInterval(() => {
      setCandles((cs) => [...cs.slice(1), step(cs[cs.length - 1]!.c)]);
    }, 900);
    return () => clearInterval(id);
  }, []);

  const hi = Math.max(...candles.map((k) => k.h));
  const lo = Math.min(...candles.map((k) => k.l));
  const y = (v: number) => 8 + ((hi - v) / (hi - lo || 1)) * 184;
  const last = candles[candles.length - 1]!;
  const first = candles[0]!;
  const price = 0.004812 * last.c;
  const change = ((last.c - first.o) / first.o) * 100;
  const w = 260 / CANDLES;

  return (
    <div className="relative mx-auto w-full max-w-[520px] py-6">
      {/* floating proof, around the phone */}
      <FloatCard className="left-0 top-10 hidden sm:flex" delay="0s">
        <span className="text-lg">🐋</span>
        <span className="leading-tight">
          <span className="block font-display text-xs font-bold text-white">0x7a…91</span>
          <span className="block font-body text-[0.68rem] text-white/50">▲ $NEON</span>
        </span>
        <span className="ml-1 rounded-lg bg-[#00FF87]/15 px-1.5 py-0.5 font-display text-xs font-black text-[#00FF87]">$12.4K</span>
      </FloatCard>
      <FloatCard className="right-0 top-36 hidden sm:flex" delay="1.2s">
        <span className="leading-tight">
          <span className="block font-body text-[0.68rem] text-white/50">PnL</span>
          <span className="block font-display text-xl font-black text-[#00FF87]">+412%</span>
        </span>
      </FloatCard>
      <FloatCard className="bottom-24 left-2 hidden sm:flex" delay="2.1s">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#00FF87] text-xs font-black text-black">✓</span>
        <span className="leading-tight">
          <span className="block font-body text-[0.68rem] text-white/50">{t('heroGas')}</span>
          <span className="block font-display text-sm font-black text-white">$0.00</span>
        </span>
      </FloatCard>

      {/* the phone */}
      <div className="kh-tilt relative mx-auto w-[292px] rounded-[44px] border border-white/15 bg-[#0B0E17] p-2.5">
        <div className="relative overflow-hidden rounded-[36px] bg-[#06080F]">
          <div className="mx-auto mt-2 h-5 w-24 rounded-full bg-black" />
          <div className="flex items-center gap-2.5 px-4 pt-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00FF87]/15 font-display text-sm font-black text-[#00FF87]">N</span>
            <span className="leading-tight">
              <span className="block font-display text-sm font-bold text-white">$NEON</span>
              <span className="block font-body text-[0.65rem] text-white/45">pump.fun · Solana</span>
            </span>
            <span className="ml-auto text-sm text-white/40">☆</span>
          </div>
          <div className="px-4 pt-3">
            <p className="font-display text-[1.7rem] font-black tabular-nums leading-none text-white">${price.toFixed(6)}</p>
            <p className="mt-1 font-body text-xs font-bold tabular-nums text-[#00FF87]">▲ {change.toFixed(1)}% · 24h</p>
          </div>
          <svg viewBox="0 0 280 200" className="mt-2 h-[200px] w-full" aria-hidden>
            {[40, 90, 140].map((g) => (
              <line key={g} x1="0" x2="280" y1={g} y2={g} stroke="rgba(255,255,255,0.05)" />
            ))}
            {candles.map((k, n) => {
              const up = k.c >= k.o;
              const x = 10 + n * w;
              const col = up ? '#00FF87' : '#FF4D6D';
              return (
                <g key={n}>
                  <line x1={x + w / 2} x2={x + w / 2} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth="1" />
                  <rect x={x + 1.5} width={w - 3} y={Math.min(y(k.o), y(k.c))} height={Math.max(1.5, Math.abs(y(k.o) - y(k.c)))} rx="1" fill={col} />
                </g>
              );
            })}
            <line x1="0" x2="280" y1={y(last.c)} y2={y(last.c)} stroke="#00FF87" strokeDasharray="3 3" strokeOpacity="0.6" />
          </svg>
          <div className="flex gap-1 px-4 pb-2 font-body text-[0.65rem] text-white/40">
            {['1s', '1m', '5m', '1H', '1D'].map((tf) => (
              <span key={tf} className={tf === '1m' ? 'rounded-md bg-[#00FF87] px-1.5 font-bold text-black' : 'px-1.5'}>
                {tf}
              </span>
            ))}
          </div>
          <div className="relative flex gap-1.5 px-3 pb-5 pt-2">
            <span className="flex h-11 flex-1 items-center justify-center rounded-2xl bg-[#00FF87] font-display text-sm font-black text-black">Buy</span>
            <span className="kw-zap flex h-11 items-center gap-0.5 rounded-2xl border border-[#00FF87]/50 bg-[#00FF87]/10 px-3 font-display text-sm font-extrabold text-[#00FF87]">
              <Zap className="h-4 w-4" fill="currentColor" aria-hidden />
              $5
            </span>
            <span className="flex h-11 flex-1 items-center justify-center rounded-2xl border border-[#FF4D6D]/40 font-display text-sm font-black text-[#FF4D6D]">Sell</span>
            <span className="kw-finger pointer-events-none absolute left-1/2 top-6 text-3xl" aria-hidden>
              👆
            </span>
          </div>
          <div className="kh-toast absolute inset-x-3 bottom-[4.6rem] flex items-center gap-2 rounded-2xl bg-[#00FF87] px-3.5 py-2.5 font-display text-xs font-black text-black">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/15">✓</span>
            $5 · $NEON
            <span className="ml-auto font-body font-bold">0.4s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FloatCard({ className, delay, children }: { className: string; delay: string; children: React.ReactNode }) {
  return (
    <div
      className={`kh-float absolute z-10 items-center gap-2 rounded-2xl border border-white/10 bg-[#0D1120] px-3 py-2.5 ${className}`}
      style={{ animationDelay: delay }}
    >
      {children}
    </div>
  );
}
