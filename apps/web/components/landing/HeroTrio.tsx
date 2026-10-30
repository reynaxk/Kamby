import { HeroPhone } from './HeroPhone';

const FEED = [
  { name: 'traderjake', tone: 'bg-[#00FF87]/15 text-[#00FF87]', coin: '$SOL', pnl: '+12.4%', path: 'M0,44 L18,40 L34,42 L52,30 L70,33 L88,22 L106,26 L124,14 L142,17 L160,6' },
  { name: 'lunatrades', tone: 'bg-[#00E5FF]/15 text-[#5CEFFF]', coin: '$WIF', pnl: '+8.4%', path: 'M0,40 L20,42 L40,34 L60,36 L80,24 L100,28 L120,18 L140,20 L160,10' },
  { name: 'moonboi', tone: 'bg-[#FFB800]/15 text-[#FFC94D]', coin: '$BONK', pnl: '+21.0%', path: 'M0,46 L20,38 L40,40 L60,26 L80,30 L100,16 L120,20 L140,8 L160,4' },
];
const CHATS = [
  { name: 'traderjake', tone: 'text-[#00FF87]', text: '🔥 +$124' },
  { name: 'lunatrades', tone: 'text-[#5CEFFF]', text: '📈 $SOL' },
  { name: 'defiqueen', tone: 'text-[#BFC3FF]', text: '🚀🚀🚀' },
  { name: 'cryptoluna', tone: 'text-[#FF9CCB]', text: 'gm ☕' },
  { name: 'moonboi', tone: 'text-[#FFC94D]', text: '🐋 $WIF' },
];

/**
 * The landing hero's phones (2026-10-30 redesign, owner's concepts): the live trading phone in
 * front, and from lg up a feed phone and a chats phone tilted behind it — Kamby is trading AND
 * people. Decorative only; numbers and names, no sentences to translate.
 */
export function HeroTrio() {
  return (
    <div className="relative flex items-center justify-center" aria-hidden>
      <SidePhone className="-mr-16 hidden translate-y-8 -rotate-6 lg:flex">
        {FEED.map((f) => (
          <div key={f.name} className="rounded-2xl border border-white/[0.07] bg-[#040507] p-2.5">
            <div className="flex items-center gap-1.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full font-display text-[0.55rem] font-black ${f.tone}`}>{f.name.slice(0, 2).toUpperCase()}</span>
              <span className="font-display text-[0.65rem] font-bold text-white">{f.name}</span>
              <span className="ml-auto font-mono text-[0.6rem] font-bold text-[#00E676]">{f.pnl}</span>
            </div>
            <svg viewBox="0 0 160 50" preserveAspectRatio="none" className="mt-1.5 h-10 w-full">
              <path d={f.path} fill="none" stroke="#00E676" strokeWidth="2" />
            </svg>
            <span className="font-mono text-[0.55rem] text-white/50">{f.coin}</span>
          </div>
        ))}
      </SidePhone>
      <div className="relative z-10">
        <HeroPhone />
      </div>
      <SidePhone className="-ml-16 hidden translate-y-8 rotate-6 lg:flex">
        {CHATS.map((c) => (
          <div key={c.name} className="self-start rounded-xl rounded-bl-sm bg-[#0E0F14] px-2.5 py-1.5 font-body text-[0.65rem] text-white/90">
            <b className={`font-display ${c.tone}`}>{c.name}</b> {c.text}
          </div>
        ))}
        <div className="self-end rounded-xl rounded-br-sm bg-[#00FF87] px-2.5 py-1.5 font-display text-[0.65rem] font-bold text-black">⚡ $SOL</div>
      </SidePhone>
    </div>
  );
}

function SidePhone({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <div className={`h-[430px] w-[210px] shrink-0 flex-col gap-2.5 overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#07080B] p-3.5 pt-10 ${className}`}>
      {children}
    </div>
  );
}
