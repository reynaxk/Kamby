/**
 * The landing page's Feed section (2026-10-31): what the Feed looks like — a trader's post with a
 * real-looking Trade Card, a PnL flex, a chart. Example posts (names and numbers only, nothing to
 * translate); decorative, aria-hidden. Copy comes in from the page's translations.
 */
export function FeedShowcase({ kicker, title, body, chips }: { kicker: string; title: string; body: string; chips: string[] }) {
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
      <div className="relative order-2 mx-auto w-full max-w-md lg:order-1" aria-hidden>
        <Post who="traderjake" tone="#00FF87" ago="2m" text="$WIF breakout, small size 👀" className="relative z-10">
          <div className="mt-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-[#040507] p-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FFC94D]/15 font-display text-xs font-black text-[#FFC94D]">W</span>
            <span className="flex-1">
              <span className="block font-display text-sm font-bold text-white">$WIF</span>
              <span className="block font-mono text-[0.65rem] text-white/50">entry $2.14 · $250</span>
            </span>
            <span className="font-mono text-sm font-bold text-[#00E676]">+12.4%</span>
            <span className="rounded-lg bg-[#00FF87] px-2.5 py-1.5 font-display text-[0.7rem] font-black text-black">⚡ Copy</span>
          </div>
        </Post>
        <Post who="lunatrades" tone="#5CEFFF" ago="18m" text="Closed $BONK 🔥" className="relative z-20 mt-3 ml-8 rotate-[1.5deg] lg:ml-14">
          <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 p-4" style={{ background: 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#020203 100%)' }}>
            <span className="font-display text-sm font-bold text-white">$BONK</span>
            <p className="mt-2 font-display text-4xl font-black leading-none tracking-tight text-[#00E676]">+236%</p>
            <p className="mt-1 font-mono text-xs font-bold text-[#00E676]">+$118.00</p>
          </div>
        </Post>
        <Post who="moonboi" tone="#FFC94D" ago="1h" text="SOL 4H — who’s in? 📈" className="relative z-10 mt-3 -rotate-[1.5deg]">
          <svg viewBox="0 0 300 90" preserveAspectRatio="none" className="mt-3 h-24 w-full rounded-2xl border border-white/10 bg-[#040507]">
            <path d="M0,80 L25,72 L50,76 L75,60 L100,64 L125,48 L150,52 L175,36 L200,40 L225,26 L250,30 L275,14 L300,18 L300,90 L0,90 Z" fill="rgba(0,230,118,0.1)" />
            <path d="M0,80 L25,72 L50,76 L75,60 L100,64 L125,48 L150,52 L175,36 L200,40 L225,26 L250,30 L275,14 L300,18" fill="none" stroke="#00E676" strokeWidth="2" />
          </svg>
        </Post>
      </div>
      <div className="order-1 lg:order-2">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#5CEFFF]">{kicker}</p>
        <h2 className="mt-3 font-display text-[clamp(2rem,4.5vw,3rem)] font-black leading-[1.05] tracking-tight text-white">{title}</h2>
        <p className="mt-4 max-w-md font-body text-base leading-relaxed text-[#94A3B8]">{body}</p>
        <div className="mt-7 flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c} className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 font-display text-xs font-bold text-white/80">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Post({ who, tone, ago, text, children, className }: { who: string; tone: string; ago: string; text: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-[#07080B] p-4 ${className ?? ''}`}>
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full border bg-[#05070A]" style={{ borderColor: `${tone}40` }}>
          <svg viewBox="0 0 512 512" className="h-[60%] w-[60%]">
            <g fill="none" stroke={tone} strokeWidth="92" strokeLinecap="round" strokeLinejoin="round">
              <path d="M186 140 V372" />
              <path d="M200 268 L338 140" />
              <path d="M232 246 L346 372" />
            </g>
          </svg>
        </span>
        <span className="flex-1">
          <span className="block font-display text-sm font-bold text-white">{who}</span>
          <span className="block font-body text-[0.65rem] text-white/45">{ago}</span>
        </span>
      </div>
      <p className="mt-2.5 font-body text-sm text-white/90">{text}</p>
      {children}
      <div className="mt-3 flex gap-4 font-display text-xs font-bold text-white/45">
        <span className="text-[#FF3B69]">♥ 128</span>
        <span>💬 24</span>
      </div>
    </div>
  );
}
