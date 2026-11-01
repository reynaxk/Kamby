'use client';

import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';

/**
 * The landing hero's picture (2026-11-01, owner: "an illustrative desktop screen and an iPhone,
 * clean and aesthetic"): Kamby on a computer — a coin's live chart and the trending list — with
 * an iPhone in front showing the same coin and its Buy bar. Everything is sized in container
 * units (cqw), so the whole scene scales as one picture from a phone to a wide screen.
 * Decorative: symbols and numbers only, nothing to translate. Motion is the chart printing.
 */

const POINTS = 40;
type Candle = { o: number; c: number; h: number; l: number };

function step(prev: number, rnd: () => number = Math.random): Candle {
  const c = Math.max(0.2, prev * (1 + 0.011 + (rnd() - 0.43) * 0.055));
  return { o: prev, c, h: Math.max(prev, c) * (1 + rnd() * 0.01), l: Math.min(prev, c) * (1 - rnd() * 0.01) };
}

/** The first frame is the same on the server and in the browser (a seeded random). */
function seed(): Candle[] {
  let a = 11;
  const rnd = () => {
    a = (a * 16807) % 2147483647;
    return a / 2147483647;
  };
  const out: Candle[] = [];
  let p = 1;
  for (let n = 0; n < POINTS; n++) {
    const k = step(p, rnd);
    out.push(k);
    p = k.c;
  }
  return out;
}

const TRENDING = [
  { s: 'NEON', c: '#00FF87', p: '+412%', d: 'M0,14 L8,12 L16,13 L24,8 L32,9 L40,3' },
  { s: 'WIF', c: '#FFB547', p: '+38.2%', d: 'M0,12 L8,13 L16,9 L24,10 L32,6 L40,5' },
  { s: 'BONK', c: '#FF8A3D', p: '+21.0%', d: 'M0,13 L8,10 L16,11 L24,7 L32,8 L40,4' },
  { s: 'TOSHI', c: '#5CEFFF', p: '+12.7%', d: 'M0,11 L8,12 L16,10 L24,11 L32,7 L40,6' },
  { s: 'FROG', c: '#A3E635', p: '−4.1%', d: 'M0,5 L8,7 L16,6 L24,10 L32,9 L40,12' },
];

export function HeroDevices() {
  const [candles, setCandles] = useState<Candle[]>(() => seed());
  useEffect(() => {
    const id = setInterval(() => setCandles((cs) => [...cs.slice(1), step(cs[cs.length - 1]!.c)]), 1100);
    return () => clearInterval(id);
  }, []);

  const hi = Math.max(...candles.map((k) => k.h));
  const lo = Math.min(...candles.map((k) => k.l));
  const last = candles[candles.length - 1]!;
  const change = ((last.c - candles[0]!.o) / candles[0]!.o) * 100;
  const price = (0.004812 * last.c).toFixed(6);
  // The desktop's area chart.
  const ly = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * 88;
  const line = candles.map((k, n) => `${n === 0 ? 'M' : 'L'}${((n / (POINTS - 1)) * 300).toFixed(1)},${ly(k.c).toFixed(1)}`).join(' ');

  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[680px] pb-[14%] pr-[4%]" style={{ containerType: 'inline-size' }}>
      {/* Desktop window */}
      <div className="overflow-hidden rounded-[1.8cqw] border border-white/[0.09] bg-[#07080C] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]">
        <div className="flex items-center gap-[1cqw] border-b border-white/[0.06] px-[2cqw] py-[1.4cqw]">
          {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
            <span key={c} className="h-[1.2cqw] w-[1.2cqw] rounded-full" style={{ backgroundColor: c }} />
          ))}
          <span className="mx-auto rounded-[0.8cqw] bg-white/[0.05] px-[4cqw] py-[0.5cqw] font-body text-[1.4cqw] text-white/45">kambesh.com</span>
        </div>
        <div className="grid grid-cols-[7cqw_1fr_25cqw]">
          {/* Side menu */}
          <div className="flex flex-col items-center gap-[2cqw] border-r border-white/[0.05] py-[2cqw]">
            <span className="flex h-[3.6cqw] w-[3.6cqw] items-center justify-center rounded-[1cqw] bg-[#00FF87]/10 font-display text-[2cqw] font-black text-[#00FF87]">K</span>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className={i === 1 ? 'h-[2.4cqw] w-[2.4cqw] rounded-[0.7cqw] bg-[#00FF87]/25' : 'h-[2.4cqw] w-[2.4cqw] rounded-[0.7cqw] bg-white/[0.07]'} />
            ))}
          </div>
          {/* Coin + chart */}
          <div className="min-w-0 p-[2.2cqw]">
            <div className="flex items-center gap-[1.2cqw]">
              <span className="flex h-[4.4cqw] w-[4.4cqw] items-center justify-center rounded-full bg-[#00FF87]/15 font-display text-[1.9cqw] font-black text-[#00FF87]">N</span>
              <span className="leading-tight">
                <span className="block font-display text-[1.9cqw] font-bold text-white">$NEON</span>
                <span className="block font-body text-[1.25cqw] text-white/40">Pump.fun · Solana</span>
              </span>
              <span className="ml-auto text-right leading-tight">
                <span className="block font-display text-[2.6cqw] font-black tabular-nums text-white">${price}</span>
                <span className="block font-body text-[1.3cqw] font-bold tabular-nums text-[#00FF87]">▲ {change.toFixed(1)}%</span>
              </span>
            </div>
            <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="mt-[2cqw] h-[22cqw] w-full">
              <defs>
                <linearGradient id="kh-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#00FF87" stopOpacity="0.28" />
                  <stop offset="1" stopColor="#00FF87" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[25, 50, 75].map((g) => (
                <line key={g} x1="0" x2="300" y1={g} y2={g} stroke="rgba(255,255,255,0.04)" vectorEffect="non-scaling-stroke" />
              ))}
              <path d={`${line} L300,100 L0,100 Z`} fill="url(#kh-area)" />
              <path d={line} fill="none" stroke="#00FF87" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="mt-[1.4cqw] flex gap-[0.8cqw] font-body text-[1.2cqw] text-white/40">
              {['1m', '5m', '1H', '4H', '1D'].map((tf) => (
                <span key={tf} className={tf === '5m' ? 'rounded-[0.6cqw] bg-white/[0.08] px-[1cqw] py-[0.3cqw] font-bold text-white' : 'px-[1cqw] py-[0.3cqw]'}>
                  {tf}
                </span>
              ))}
            </div>
          </div>
          {/* Trending */}
          <div className="border-l border-white/[0.05] p-[1.8cqw]">
            <p className="font-display text-[1.4cqw] font-bold text-white/70">Trending</p>
            <ul className="mt-[1.2cqw] flex flex-col gap-[1.1cqw]">
              {TRENDING.map((x) => (
                <li key={x.s} className="flex items-center gap-[0.9cqw]">
                  <span className="flex h-[3cqw] w-[3cqw] shrink-0 items-center justify-center rounded-full font-display text-[1.2cqw] font-black text-black" style={{ backgroundColor: x.c }}>
                    {x.s[0]}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-display text-[1.3cqw] font-bold text-white">${x.s}</span>
                  <svg viewBox="0 0 40 16" className="h-[2cqw] w-[4.4cqw] shrink-0">
                    <path d={x.d} fill="none" stroke={x.p.startsWith('−') ? '#FF4D6D' : '#00E676'} strokeWidth="1.6" />
                  </svg>
                </li>
              ))}
            </ul>
            <span className="mt-[2cqw] flex h-[3.8cqw] items-center justify-center rounded-[1cqw] bg-[#00FF87] font-display text-[1.4cqw] font-black text-black">Buy</span>
          </div>
        </div>
      </div>

      {/* iPhone */}
      <div className="absolute bottom-0 right-0 w-[29%]" style={{ containerType: 'inline-size' }}>
        <div className="rounded-[15cqw] bg-[linear-gradient(145deg,#3A3D45,#121318_40%,#2A2C33)] p-[2.2cqw] shadow-[0_30px_60px_-15px_rgba(0,0,0,0.95)]">
          <div className="relative overflow-hidden rounded-[13cqw] bg-[#030305]" style={{ aspectRatio: '9 / 19.5' }}>
            {/* status bar + Dynamic Island */}
            <div className="flex items-center justify-between px-[9cqw] pt-[5cqw] font-display text-[4.2cqw] font-bold text-white">
              <span>9:41</span>
              <span className="tracking-[-0.1em] text-white/80">▮▮▮</span>
            </div>
            <span className="absolute left-1/2 top-[3.6cqw] h-[8cqw] w-[30cqw] -translate-x-1/2 rounded-full bg-black" />
            <div className="mt-[7cqw] flex items-center gap-[3cqw] px-[6cqw]">
              <span className="flex h-[11cqw] w-[11cqw] items-center justify-center rounded-full bg-[#00FF87]/15 font-display text-[5cqw] font-black text-[#00FF87]">N</span>
              <span className="leading-tight">
                <span className="block font-display text-[5.4cqw] font-bold text-white">$NEON</span>
                <span className="block font-body text-[3.6cqw] text-white/40">Solana</span>
              </span>
            </div>
            <p className="mt-[5cqw] px-[6cqw] font-display text-[9cqw] font-black tabular-nums leading-none text-white">${price}</p>
            <p className="mt-[1.5cqw] px-[6cqw] font-body text-[4cqw] font-bold tabular-nums text-[#00FF87]">▲ {change.toFixed(1)}% · 24h</p>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-[5cqw] h-[70cqw] w-full">
              {candles.slice(-18).map((k, n, arr) => {
                const h2 = Math.max(...arr.map((x) => x.h));
                const l2 = Math.min(...arr.map((x) => x.l));
                const y = (v: number) => 4 + ((h2 - v) / (h2 - l2 || 1)) * 92;
                const w = 100 / arr.length;
                const up = k.c >= k.o;
                const col = up ? '#00FF87' : '#FF4D6D';
                return (
                  <g key={n}>
                    <line x1={n * w + w / 2} x2={n * w + w / 2} y1={y(k.h)} y2={y(k.l)} stroke={col} strokeWidth="0.6" />
                    <rect x={n * w + w * 0.18} width={w * 0.64} y={Math.min(y(k.o), y(k.c))} height={Math.max(0.8, Math.abs(y(k.o) - y(k.c)))} rx="0.4" fill={col} />
                  </g>
                );
              })}
            </svg>
            <div className="absolute inset-x-[5cqw] bottom-[9cqw] flex gap-[2cqw]">
              <span className="flex h-[13cqw] flex-1 items-center justify-center rounded-[5cqw] bg-[#00FF87] font-display text-[4.6cqw] font-black text-black">Buy</span>
              <span className="flex h-[13cqw] items-center gap-[0.5cqw] rounded-[5cqw] border border-[#00FF87]/50 bg-[#00FF87]/10 px-[3.5cqw] font-display text-[4.4cqw] font-extrabold text-[#00FF87]">
                <Zap className="h-[4.4cqw] w-[4.4cqw]" fill="currentColor" />$5
              </span>
              <span className="flex h-[13cqw] flex-1 items-center justify-center rounded-[5cqw] border border-[#FF4D6D]/40 font-display text-[4.6cqw] font-black text-[#FF4D6D]">Sell</span>
            </div>
            <span className="absolute bottom-[3cqw] left-1/2 h-[1.4cqw] w-[34cqw] -translate-x-1/2 rounded-full bg-white/70" />
          </div>
        </div>
      </div>
    </div>
  );
}
