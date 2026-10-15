/**
 * The landing page's "flex every win" showcase (2026-10-15): two of Kamby's PnL share cards (the
 * owner's favourite piece of the app), stacked like a phone screenshot — sample numbers, the same
 * look as the real cards (components/share/PnlShareCard.tsx). Static, server-rendered.
 */
const K_PATHS = ['M186 140 V372', 'M200 268 L338 140', 'M232 246 L346 372'];

function SampleCard({
  theme,
  ticker,
  user,
  pct,
  usd,
  invested,
  worth,
  coin,
  className,
}: {
  theme: 'neon' | 'midnight';
  ticker: string;
  user: string;
  pct: string;
  usd: string;
  invested: string;
  worth: string;
  coin: string;
  className?: string;
}) {
  const neon = theme === 'neon';
  return (
    <div
      className={`h-[350px] w-[280px] overflow-hidden rounded-[26px] border border-white/10 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)] ${className ?? ''}`}
      style={{ background: neon ? '#05070A' : 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#05070A 100%)' }}
    >
      <svg className="pointer-events-none absolute -right-14 -top-4" width="260" height="260" viewBox="0 0 512 512" aria-hidden="true">
        <g fill="none" stroke={neon ? '#00FF87' : '#FFFFFF'} strokeWidth="92" strokeLinecap="round" opacity={neon ? 0.08 : 0.05}>
          {K_PATHS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      </svg>
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kamby-mark.svg" alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-md" />
          <span className="font-display text-sm font-black tracking-tight text-white">KAMBY</span>
        </span>
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 font-body text-[0.55rem] font-semibold uppercase tracking-wider text-white/50">{coin}</span>
      </div>
      <div className="relative mt-5 flex items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF87] to-[#00B4D8] font-display text-sm font-bold text-black">{ticker[1]}</span>
        <span>
          <span className="block font-display text-xl font-bold leading-tight text-white">{ticker}</span>
          <span className="block font-body text-[0.68rem] text-white/50">{user}</span>
        </span>
      </div>
      <p className="relative mt-4 font-display text-[3.3rem] font-black leading-none tracking-tight text-[#00FF87]">{pct}</p>
      <p className="relative mt-1.5 font-body text-lg font-bold tabular-nums text-[#00FF87]">{usd}</p>
      <div className="absolute inset-x-5 bottom-5 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.06] p-3 font-body text-[0.62rem]">
        <span>
          <span className="block text-white/50">Invested</span>
          <span className="block text-sm font-semibold tabular-nums text-white">{invested}</span>
        </span>
        <span>
          <span className="block text-white/50">Worth now</span>
          <span className="block text-sm font-semibold tabular-nums text-white">{worth}</span>
        </span>
      </div>
    </div>
  );
}

export function PnlShowcase({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-10 lg:flex-row lg:justify-between">
      <div className="max-w-md text-center lg:text-left">
        <h2 className="font-display text-3xl font-black tracking-tight text-white sm:text-4xl">{title}</h2>
        <p className="mt-3 font-body text-[0.95rem] leading-relaxed text-[#7C8798]">{body}</p>
      </div>
      <div className="relative h-[400px] w-[320px] shrink-0">
        <SampleCard theme="midnight" ticker="$WIF" user="@moonboi" pct="+87%" usd="+$43.50" invested="$50.00" worth="$93.50" coin="Solana" className="absolute left-0 top-0 -rotate-6" />
        <SampleCard theme="neon" ticker="$CAT" user="@sandy" pct="+412%" usd="+$494.40" invested="$120.00" worth="$614.40" coin="Base" className="absolute bottom-0 right-0 rotate-3" />
      </div>
    </div>
  );
}
