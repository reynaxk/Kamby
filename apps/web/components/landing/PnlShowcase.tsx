import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';

/**
 * The landing page's "flex every win" strip (2026-10-17 rewrite): Kamby's PnL share cards — the
 * owner's favourite piece of the app — drifting past in an endless marquee. Example numbers,
 * labelled as examples (owner's call: no "verified live" claim until real trades fill it).
 * Pure CSS motion (one translateX on the track, compositor-only), paused on hover, still for
 * reduced motion. Server-rendered.
 */
const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

interface Sample {
  theme: 'neon' | 'midnight';
  ticker: string;
  user: string;
  pct: string;
  usd: string;
  invested: string;
  worth: string;
  chain: BadgeChain;
}

const CHAIN_NAME: Record<BadgeChain, string> = { solana: 'Solana', base: 'Base', bnb: 'BNB Chain', robinhood: 'Robinhood' };

const SAMPLES: Sample[] = [
  { theme: 'neon', ticker: '$CAT', user: '@sandy', pct: '+412%', usd: '+$494.40', invested: '$120.00', worth: '$614.40', chain: 'base' },
  { theme: 'midnight', ticker: '$WIF', user: '@moonboi', pct: '+87%', usd: '+$43.50', invested: '$50.00', worth: '$93.50', chain: 'solana' },
  { theme: 'neon', ticker: '$FROG', user: '@degenbg', pct: '+1,280%', usd: '+$640.00', invested: '$50.00', worth: '$690.00', chain: 'bnb' },
  { theme: 'midnight', ticker: '$HOOD', user: '@tati', pct: '+850%', usd: '+$255.00', invested: '$30.00', worth: '$285.00', chain: 'robinhood' },
  { theme: 'neon', ticker: '$BONK', user: '@kambyfather', pct: '+236%', usd: '+$118.00', invested: '$50.00', worth: '$168.00', chain: 'solana' },
  { theme: 'midnight', ticker: '$TOSHI', user: '@whale.eth', pct: '+164%', usd: '+$1,640', invested: '$1,000', worth: '$2,640', chain: 'base' },
];

function ShareIcon({ kind }: { kind: 'x' | 'tiktok' }) {
  return kind === 'x' ? (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.8 3H21l-7 8 8.2 10h-6.4l-5-6.2L5.1 21H2l7.5-8.6L1.6 3h6.5l4.5 5.7L17.8 3Z" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.6 3c.4 2.2 1.8 3.7 4 4v3.1c-1.5 0-2.9-.4-4-1.2v6.6A6.5 6.5 0 1 1 10 9v3.2a3.3 3.3 0 1 0 3.3 3.3V3h3.3Z" />
    </svg>
  );
}

function SampleCard({ s }: { s: Sample }) {
  const neon = s.theme === 'neon';
  return (
    <div
      className="relative h-[330px] w-[260px] shrink-0 overflow-hidden rounded-[26px] border border-[#00FF87]/15 p-5 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)]"
      style={{ background: neon ? 'linear-gradient(165deg,rgba(255,255,255,0.06),rgba(255,255,255,0.01) 45%),#05070A' : 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#05070A 100%)' }}
    >
      <svg className="pointer-events-none absolute -right-14 -top-4" width="240" height="240" viewBox="0 0 512 512" aria-hidden="true">
        <g fill="none" stroke={neon ? '#00FF87' : '#FFFFFF'} strokeWidth="92" strokeLinecap="round" opacity={neon ? 0.08 : 0.05}>
          {K_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kamby-mark.svg" alt="" width={20} height={20} className="h-5 w-5 rounded-md" />
          <span className="font-display text-sm font-black tracking-tight text-white">KAMBY</span>
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-white/[0.07] py-0.5 pl-1 pr-2">
          <span className="relative h-3.5 w-3.5">
            <ChainBadge chain={s.chain} className="!static !h-3.5 !w-3.5 !ring-0" />
          </span>
          <span className="font-body text-[0.55rem] font-semibold uppercase tracking-wider text-white/60">{CHAIN_NAME[s.chain]}</span>
        </span>
      </div>
      <div className="relative mt-5 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF87] to-[#00B4D8] font-display text-sm font-bold text-black">{s.ticker[1]}</span>
        <span>
          <span className="block font-display text-xl font-bold leading-tight text-white">{s.ticker}</span>
          <span className="block font-body text-[0.68rem] text-white/50">{s.user}</span>
        </span>
      </div>
      <p className="relative mt-4 font-display text-[3rem] font-black leading-none tracking-tight text-[#00FF87]">{s.pct}</p>
      <p className="relative mt-1.5 font-body text-lg font-bold tabular-nums text-[#00FF87]">{s.usd}</p>
      <div className="absolute inset-x-5 bottom-14 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.06] p-2.5 font-body text-[0.6rem]">
        <span>
          <span className="block text-white/50">Invested</span>
          <span className="block text-sm font-semibold tabular-nums text-white">{s.invested}</span>
        </span>
        <span>
          <span className="block text-white/50">Worth now</span>
          <span className="block text-sm font-semibold tabular-nums text-white">{s.worth}</span>
        </span>
      </div>
      {/* The real card's one-tap share row, drawn (an example card shares nothing). */}
      <div className="absolute inset-x-5 bottom-4 flex gap-1.5" aria-hidden>
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-1.5 font-display text-[0.65rem] font-bold text-black">
          <ShareIcon kind="x" /> Share to X
        </span>
        <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.08] py-1.5 font-display text-[0.65rem] font-bold text-white">
          <ShareIcon kind="tiktok" /> TikTok
        </span>
      </div>
    </div>
  );
}

export function PnlShowcase({ title, body, note }: { title: string; body: string; note: string }) {
  return (
    <div>
      <div className="mx-auto max-w-2xl px-5 text-center">
        <h2 className="font-display text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h2>
        <p className="mt-3 font-body text-[0.95rem] leading-relaxed text-[#7C8798]">{body}</p>
      </div>
      <div className="kamby-marquee-mask relative mt-12 overflow-hidden">
        <div className="kamby-marquee flex w-max gap-5 px-2.5">
          {/* Twice, so the loop has no seam — the copy is hidden from screen readers. */}
          {[...SAMPLES, ...SAMPLES].map((s, i) => (
            <div key={`${s.ticker}-${i}`} aria-hidden={i >= SAMPLES.length || undefined}>
              <SampleCard s={s} />
            </div>
          ))}
        </div>
      </div>
      <p className="mt-6 text-center font-mono text-[0.65rem] uppercase tracking-[0.25em] text-white/30">{note}</p>
    </div>
  );
}
