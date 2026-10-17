import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

/**
 * The landing hero's preview of the Kamby terminal (2026-10-17 landing rewrite): a frosted
 * window with a candle chart, the coin's price and Buy/Sell, and a Trenches feed beside it.
 * An illustration with made-up numbers — server-rendered, no data, no client code; the only
 * motion is CSS (the last candle breathing, the window floating), transform-only.
 */

// Fixed candles (open, close, high, low as 0–100 of the chart height), so the render is stable.
const CANDLES: [number, number, number, number][] = [
  [30, 34, 37, 27], [34, 31, 36, 28], [31, 38, 40, 30], [38, 36, 41, 33], [36, 44, 46, 35],
  [44, 41, 47, 39], [41, 49, 52, 40], [49, 47, 53, 44], [47, 55, 58, 46], [55, 52, 57, 49],
  [52, 60, 63, 51], [60, 57, 62, 54], [57, 66, 69, 56], [66, 63, 68, 60], [63, 72, 75, 62],
  [72, 69, 74, 66], [69, 78, 82, 68], [78, 75, 80, 72], [75, 84, 88, 74], [84, 91, 94, 82],
];

const TRENCHES: { symbol: string; chain: BadgeChain; progress: number; age: string; hue: string }[] = [
  { symbol: 'NEON', chain: 'solana', progress: 86, age: '12s', hue: '#00FF87' },
  { symbol: 'WHALE', chain: 'base', progress: 64, age: '41s', hue: '#38BDF8' },
  { symbol: 'KAT', chain: 'bnb', progress: 47, age: '1m', hue: '#FACC15' },
  { symbol: 'HOOD', chain: 'robinhood', progress: 29, age: '2m', hue: '#CCFF00' },
  { symbol: 'MOON', chain: 'solana', progress: 12, age: '3m', hue: '#A78BFA' },
];

function CandleChart() {
  const w = 100 / CANDLES.length;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      {[20, 40, 60, 80].map((y) => (
        <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
      ))}
      {CANDLES.map(([open, close, high, low], i) => {
        const up = close >= open;
        const color = up ? '#00FF87' : '#FF3B69';
        const x = i * w + w / 2;
        const top = 100 - Math.max(open, close);
        const height = Math.max(1.2, Math.abs(close - open));
        const last = i === CANDLES.length - 1;
        return (
          <g key={i} className={last ? 'kamby-mock-candle' : undefined}>
            <line x1={x} x2={x} y1={100 - high} y2={100 - low} stroke={color} strokeWidth="0.5" vectorEffect="non-scaling-stroke" opacity="0.8" />
            <rect x={x - w * 0.3} y={top} width={w * 0.6} height={height} fill={color} rx="0.3" />
          </g>
        );
      })}
      <line x1="0" x2="100" y1="9" y2="9" stroke="#00FF87" strokeWidth="0.6" strokeDasharray="1.5 1.5" vectorEffect="non-scaling-stroke" opacity="0.7" />
    </svg>
  );
}

export function TerminalMockup() {
  return (
    <div className="kamby-mock-float relative w-full max-w-[560px] [perspective:1400px]">
      <div className="kamby-mock-window relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.09),rgba(255,255,255,0.02)_55%)] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9),0_0_0_1px_rgba(0,255,135,0.06),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl lg:[transform:rotateY(-9deg)_rotateX(4deg)]">
        {/* Window bar */}
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]/80" />
          <span className="ml-3 rounded-md bg-white/[0.05] px-2.5 py-0.5 font-mono text-[0.6rem] text-white/40">kambesh.com/terminal</span>
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-3 p-3 sm:grid-cols-[1fr_11rem] sm:p-4">
          {/* Chart + trade */}
          <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-black/30 p-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF87] to-[#00B4D8] font-display text-xs font-black text-black">
                N
                <ChainBadge chain="solana" className="ring-[#0A0C12]" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-sm font-bold leading-tight text-white">$NEON</span>
                <span className="block font-mono text-[0.6rem] text-white/40">pump.fun · 4m</span>
              </span>
              <span className="ml-auto text-right">
                <span className="block font-display text-sm font-bold tabular-nums text-white">$0.004812</span>
                <span className="block font-mono text-[0.6rem] font-semibold tabular-nums text-[#00FF87]">▲ +412.6%</span>
              </span>
            </div>
            <div className="mt-3 h-36 sm:h-44">
              <CandleChart />
            </div>
            <div className="mt-2 flex gap-1 font-mono text-[0.55rem] text-white/35">
              {['1s', '1m', '5m', '1H', '4H', '1D'].map((tf) => (
                <span key={tf} className={tf === '1m' ? 'rounded bg-[#00FF87] px-1.5 py-0.5 font-bold text-black' : 'px-1.5 py-0.5'}>
                  {tf}
                </span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[2fr_1fr] gap-1.5">
              <span className="rounded-xl bg-[#00FF87] py-2 text-center font-display text-xs font-black text-black">Buy</span>
              <span className="rounded-xl border border-[#FF3B69]/30 bg-[#FF3B69]/[0.08] py-2 text-center font-display text-xs font-black text-[#FF3B69]">Sell</span>
            </div>
          </div>

          {/* Trenches */}
          <div className="hidden min-w-0 flex-col rounded-2xl border border-white/[0.06] bg-black/30 p-2.5 sm:flex">
            <span className="flex items-center gap-1.5 px-1 font-mono text-[0.6rem] uppercase tracking-wider text-white/45">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FF87]" />
              Trenches
            </span>
            <div className="mt-2 flex flex-col gap-1.5">
              {TRENCHES.map((c) => (
                <div key={c.symbol} className="rounded-xl bg-white/[0.03] px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-display text-[0.55rem] font-black text-black" style={{ background: c.hue }}>
                      {c.symbol[0]}
                      <ChainBadge chain={c.chain} className="h-2 w-2 ring-1 ring-[#0A0C12]" />
                    </span>
                    <span className="truncate font-display text-[0.65rem] font-bold text-white">${c.symbol}</span>
                    <span className="ml-auto font-mono text-[0.55rem] text-white/35">{c.age}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#00FF87] to-[#00B4D8]" style={{ width: `${c.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
