import { ChainBadge } from '@/components/market/ChainBadge';

/**
 * The landing page's chat preview (owner 2026-10-17: "show the global chat and the live chat for
 * every coin"): two frosted windows — Pulse, the worldwide chat, and a coin's live chat where
 * real trades stream in between messages, with 🐳 / ⚡ / 👑 badges and reactions. An
 * illustration with made-up lines; the feeds scroll up in an endless CSS loop (one translateY
 * per column, paused for reduced motion). Server-rendered.
 */

type Line =
  | { kind: 'msg'; user: string; color: string; text: string; badge?: string }
  | { kind: 'trade'; user: string; side: 'buy' | 'sell'; usd: string; badge?: string }
  | { kind: 'pnl'; user: string; pct: string };

const PULSE: Line[] = [
  { kind: 'msg', user: 'moonboi', color: '#38BDF8', text: 'gm traders ☀️' },
  { kind: 'msg', user: 'tati', color: '#F472B6', text: 'anyone watching $NEON? curve almost full' },
  { kind: 'msg', user: 'whale.eth', color: '#A78BFA', text: 'base is cooking today', badge: '🐳' },
  { kind: 'pnl', user: 'degenbg', pct: '+1,280%' },
  { kind: 'msg', user: 'sandy', color: '#00FF87', text: 'just launched mine on Kamby’s LaunchPad 👑' },
  { kind: 'msg', user: 'kat', color: '#FACC15', text: 'no gas, only USDC — finally' },
  { kind: 'msg', user: 'hoodie', color: '#CCFF00', text: 'robinhood chain pumps feel different' },
  { kind: 'msg', user: 'zen', color: '#FB923C', text: 'wagmi 🚀' },
];

const COIN: Line[] = [
  { kind: 'trade', user: 'whale.eth', side: 'buy', usd: '$2,400', badge: '🐳' },
  { kind: 'msg', user: 'moonboi', color: '#38BDF8', text: 'whale in 👀', badge: '⚡' },
  { kind: 'trade', user: 'tati', side: 'buy', usd: '$50' },
  { kind: 'msg', user: 'neondev', color: '#00FF87', text: 'thanks for the support fam', badge: '👑' },
  { kind: 'trade', user: 'zen', side: 'sell', usd: '$120' },
  { kind: 'pnl', user: 'kat', pct: '+412%' },
  { kind: 'msg', user: 'degenbg', color: '#F472B6', text: 'chart looks like a staircase' },
  { kind: 'trade', user: 'sandy', side: 'buy', usd: '$300', badge: '⚡' },
];

function Row({ line }: { line: Line }) {
  if (line.kind === 'trade') {
    const buy = line.side === 'buy';
    return (
      <div className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 ${buy ? 'bg-[#00FF87]/[0.07]' : 'bg-[#FF3B69]/[0.07]'}`}>
        <span className={`rounded-md px-1.5 py-0.5 font-mono text-[0.55rem] font-bold uppercase ${buy ? 'bg-[#00FF87] text-black' : 'bg-[#FF3B69] text-white'}`}>{buy ? 'Buy' : 'Sell'}</span>
        <span className="truncate font-display text-xs font-bold text-white">
          {line.badge && <span className="mr-1">{line.badge}</span>}
          {line.user}
        </span>
        <span className={`ml-auto font-display text-xs font-bold tabular-nums ${buy ? 'text-[#00FF87]' : 'text-[#FF3B69]'}`}>{line.usd}</span>
      </div>
    );
  }
  if (line.kind === 'pnl') {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[#00FF87]/20 bg-[linear-gradient(120deg,rgba(0,255,135,0.10),rgba(0,180,216,0.04))] px-2.5 py-2">
        <span className="font-display text-xs font-bold text-white">{line.user}</span>
        <span className="font-body text-[0.65rem] text-white/50">flexed a win</span>
        <span className="ml-auto font-display text-sm font-black tabular-nums text-[#00FF87]">{line.pct}</span>
      </div>
    );
  }
  return (
    <div className="px-2.5 py-1 font-body text-[0.78rem] leading-snug text-white/85">
      {line.badge && <span className="mr-1">{line.badge}</span>}
      <span className="font-display font-bold" style={{ color: line.color }}>
        {line.user}
      </span>{' '}
      {line.text}
    </div>
  );
}

function Feed({ lines, slow }: { lines: Line[]; slow?: boolean }) {
  return (
    <div className="kamby-chat-mask relative h-[300px] overflow-hidden">
      <div className={`kamby-chat-loop flex flex-col gap-1.5 ${slow ? 'kamby-chat-loop-slow' : ''}`}>
        {/* Twice, so the loop has no seam — the copy is hidden from screen readers. */}
        {[...lines, ...lines].map((line, i) => (
          <div key={i} aria-hidden={i >= lines.length || undefined}>
            <Row line={line} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Window({ children, head }: { children: React.ReactNode; head: React.ReactNode }) {
  return (
    <div className="kamby-bento relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.08),rgba(255,255,255,0.015)_55%)] p-4 shadow-[0_30px_90px_-30px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.1)]">
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] pb-3">{head}</div>
      <div className="mt-3">{children}</div>
      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-black/30 px-3 py-2.5" aria-hidden>
        <span className="font-body text-xs text-white/30">Say something…</span>
        <span className="ml-auto flex gap-1 text-sm">🔥 💎 🚀</span>
      </div>
    </div>
  );
}

export function ChatShowcase({ title, body, pulseTitle, pulseSub, coinTitle, coinSub }: { title: string; body: string; pulseTitle: string; pulseSub: string; coinTitle: string; coinSub: string }) {
  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h2>
        <p className="mt-3 font-body text-[0.95rem] leading-relaxed text-[#7C8798]">{body}</p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        <Window
          head={
            <>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87]" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
                </svg>
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-white">{pulseTitle}</span>
                <span className="flex items-center gap-1.5 font-body text-[0.68rem] text-white/45">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#00FF87]" />
                  {pulseSub}
                </span>
              </span>
            </>
          }
        >
          <Feed lines={PULSE} slow />
        </Window>
        <Window
          head={
            <>
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#00FF87] to-[#00B4D8] font-display text-sm font-black text-black">
                N
                <ChainBadge chain="solana" className="ring-[#0A0C12]" />
              </span>
              <span>
                <span className="block font-display text-sm font-bold text-white">$NEON · {coinTitle}</span>
                <span className="flex items-center gap-1.5 font-body text-[0.68rem] text-white/45">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF3B69]" />
                  {coinSub}
                </span>
              </span>
            </>
          }
        >
          <Feed lines={COIN} />
        </Window>
      </div>
    </div>
  );
}
