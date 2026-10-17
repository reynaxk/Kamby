'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ArrowUp, Flag, SlidersHorizontal, TrendingUp } from 'lucide-react';
import {
  chatTokenKey,
  containsLink,
  DEFAULT_REACTIONS,
  PULSE_LIMITS,
  TOKEN_CHAT_REACTIONS,
  type TokenChatBadge,
  type TokenChatItem,
} from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { ChatUsernameSetup } from './ChatUsernameSetup';
import { useMyPosition } from '@/lib/my-positions';
import { useMyUsername } from '@/lib/use-my-username';
import { postTokenMessage, postTokenPnl, reportMessage, sendReaction, useTokenChat } from '@/lib/token-chat-client';

const BADGE_ICON: Record<TokenChatBadge, string> = { whale: '🐳', top: '⚡', dev: '👑' };
const REACTIONS_KEY = 'kamby:chat-reactions';
const MAX_FLYING = 18;

function money(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 10_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: usd < 100 ? 2 : 0, maximumFractionDigits: usd < 100 ? 2 : 0 })}`;
}

function pct(value: number | null): string | null {
  if (value === null) return null;
  return `${value >= 0 ? '+' : ''}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
}

/** $SYMBOL mentions lit up in Kamby green; everything else plain text (no links, ever). */
function Body({ text }: { text: string }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9]{0,14})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\$[A-Za-z]/.test(part) ? (
          <span key={i} className="font-semibold text-accent">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function useMyReactions(): [string[], (next: string[]) => void] {
  const [picks, setPicks] = useState<string[]>([...DEFAULT_REACTIONS]);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(REACTIONS_KEY) ?? 'null') as unknown;
      if (Array.isArray(saved) && saved.length === 4 && saved.every((e) => (TOKEN_CHAT_REACTIONS as readonly string[]).includes(e as string))) setPicks(saved as string[]);
    } catch {
      // defaults
    }
  }, []);
  const save = (next: string[]) => {
    setPicks(next);
    try {
      window.localStorage.setItem(REACTIONS_KEY, JSON.stringify(next));
    } catch {
      // applied, not remembered
    }
  };
  return [picks, save];
}

interface Flying {
  id: number;
  emoji: string;
  x: number;
}

/** The emojis floating up over the chat. Owns its own state and hands its `fly` to the parent
 *  through `register`, so a burst of reactions re-renders only this layer, never the messages. */
const FlyingReactions = memo(function FlyingReactions({ register }: { register: (fly: (emoji: string) => void) => void }) {
  const [flying, setFlying] = useState<Flying[]>([]);
  const nextId = useRef(0);
  useEffect(() => {
    register((emoji) => {
      const id = ++nextId.current;
      setFlying((prev) => [...prev.slice(-(MAX_FLYING - 1)), { id, emoji, x: 12 + Math.random() * 64 }]);
      setTimeout(() => setFlying((prev) => prev.filter((f) => f.id !== id)), 1800);
    });
  }, [register]);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <AnimatePresence>
        {flying.map((f) => (
          <motion.span
            key={f.id}
            initial={{ y: 0, opacity: 1, scale: 0.6 }}
            animate={{ y: -240, opacity: 0, scale: 1.25, x: (f.id % 2 ? 1 : -1) * 18 }}
            transition={{ duration: 1.7, ease: 'easeOut' }}
            className="absolute bottom-2 text-2xl will-change-transform"
            style={{ left: `${f.x}%` }}
          >
            {f.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
});

/**
 * A coin's live chat, Twitch-style (2026-10-14): newest at the bottom, auto-scrolling unless
 * you've scrolled up to read (then a "new" pill brings you back), Kamby users' trades streaming
 * in between the messages, PnL flexes as micro-cards (the server builds them from your real
 * position), and reactions that float up over the chat for everyone watching. Keeps at most
 * TOKEN_CHAT_LIMITS.maxOnScreen items, so no list virtualization is needed for 60fps.
 */
export function TokenStreamChat({
  chainIdentifier,
  address,
  symbol,
  className,
  phone = false,
}: {
  chainIdentifier: string;
  address: string;
  symbol: string | null;
  className?: string;
  /** Inside the phone coin screen: room for the Buy/Sell bar under it. */
  phone?: boolean;
}) {
  const t = useTranslations('tokenChat');
  const tP = useTranslations('pulse');
  const tAuth = useTranslations('auth');
  const tokenKey = chatTokenKey(chainIdentifier, address);
  const { ready, authenticated, login } = usePrivy();
  const position = useMyPosition(address);
  // Your @name — only "none" once the server says so (see useMyUsername).
  const [username, setUsername] = useMyUsername(authenticated);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(() => new Set());
  const [picking, setPicking] = useState(false);
  const [picks, setPicks] = useMyReactions();
  const flyRef = useRef<(emoji: string) => void>(() => undefined);
  const registerFly = useCallback((fly: (emoji: string) => void) => {
    flyRef.current = fly;
  }, []);
  const ownPending = useRef<Record<string, number>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastCount = useRef(0);

  const fly = useCallback((emoji: string) => flyRef.current(emoji), []);

  const onReaction = useCallback(
    (emoji: string) => {
      // Your own reaction comes back over the stream — it already flew when you tapped it.
      const pending = ownPending.current[emoji] ?? 0;
      if (pending > 0) {
        ownPending.current[emoji] = pending - 1;
        return;
      }
      fly(emoji);
    },
    [fly],
  );

  const { items, status, add, remove } = useTokenChat(tokenKey, onReaction);



  // Follow the newest message — unless the reader scrolled up, then count what's new.
  useLayoutEffect(() => {
    const el = listRef.current;
    const count = items?.length ?? 0;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    else if (count > lastCount.current) setUnread((n) => n + (count - lastCount.current));
    lastCount.current = count;
  }, [items]);

  function jumpToNewest() {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    stick.current = true;
    setUnread(0);
  }

  function explain(e: unknown): string {
    const code = (e as { status?: number }).status;
    return code === 429 ? tP('slowDown') : code === 403 ? tP('needUsername') : code === 400 ? (e as Error).message : tP('sendFailed');
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sending || !tokenKey) return;
    if (containsLink(body)) {
      setError(tP('noLinks'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      add(await postTokenMessage(tokenKey, body));
      stick.current = true;
      setDraft('');
    } catch (e) {
      setError(explain(e));
    } finally {
      setSending(false);
    }
  }

  async function flexPnl() {
    if (sending || !tokenKey) return;
    setSending(true);
    setError(null);
    try {
      add(await postTokenPnl(tokenKey));
      stick.current = true;
    } catch (e) {
      setError(explain(e));
    } finally {
      setSending(false);
    }
  }

  function react(emoji: string) {
    if (!tokenKey) return;
    fly(emoji);
    if (!authenticated) return; // it still flies for you; only signed-in reactions reach others
    ownPending.current[emoji] = (ownPending.current[emoji] ?? 0) + 1;
    setTimeout(() => {
      ownPending.current[emoji] = Math.max(0, (ownPending.current[emoji] ?? 0) - 1);
    }, 3000);
    void sendReaction(tokenKey, emoji).catch(() => undefined);
  }

  const report = useCallback(
    async (id: string) => {
      setReported((prev) => new Set(prev).add(id));
      setSelected(null);
      try {
        const { hidden } = await reportMessage(id);
        if (hidden) remove(id);
      } catch {
        // already reported, or signed out — nothing to show
      }
    },
    [remove],
  );
  const select = useCallback((id: string) => setSelected((cur) => (cur === id ? null : id)), []);

  if (!tokenKey) return null;
  const left = PULSE_LIMITS.maxLength - draft.length;
  const canPost = ready && authenticated && username;

  return (
    <div className={cn('relative flex min-h-0 flex-col overflow-hidden', className)}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={cn('h-2 w-2 rounded-full', status === 'live' ? 'animate-pulse bg-accent' : 'bg-ink-400')} aria-hidden />
        <p className="font-display text-xs font-bold uppercase tracking-wide text-ink-900">{t('title')}</p>
        {/* Pulse's "live" line says "worldwide" — this room is one coin, so the green dot says it. */}
        {status !== 'live' && <p className="font-body text-[0.7rem] text-ink-400">{tP('connecting')}</p>}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            stick.current = atBottom;
            if (atBottom && unread) setUnread(0);
          }}
          className="h-full overflow-y-auto overscroll-contain px-3"
        >
          {items === null ? (
            <p className="py-8 text-center font-body text-sm text-ink-400">…</p>
          ) : items.length === 0 ? (
<div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#00FF87]/20 bg-[#00FF87]/[0.08] text-[#00FF87]">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z" />
                <path d="M8.5 12h.01M12 12h.01M15.5 12h.01" />
              </svg>
            </span>
            <p className="max-w-[16rem] font-body text-sm text-ink-400">{t('empty', { symbol: symbol ?? '' })}</p>
          </div>
          ) : (
            <ul className="flex flex-col gap-1.5 py-2">
              {items.map((item) => (
                <ChatRow
                  key={`${item.kind}:${item.id}`}
                  item={item}
                  selected={selected === item.id}
                  reported={reported.has(item.id)}
                  onSelect={select}
                  onReport={authenticated ? report : null}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Reactions float up over the chat. */}
        <FlyingReactions register={registerFly} />

        {unread > 0 && (
          <button
            type="button"
            onClick={jumpToNewest}
            className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-accent px-3 py-1 font-display text-xs font-bold text-black shadow-lg"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            {t('newMessages', { n: String(unread) })}
          </button>
        )}
      </div>

      {/* Reactions — your four, the slider swaps them. */}
      <div className="relative flex items-center gap-1 border-t border-white/5 px-2 pt-1.5">
        {picks.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => react(emoji)}
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg transition-transform active:scale-90 hover:bg-white/5"
            aria-label={emoji}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          aria-label={t('customize')}
          aria-expanded={picking}
          className={cn('ml-auto flex h-8 w-8 items-center justify-center rounded-full text-ink-400 hover:bg-white/5 hover:text-ink-900', picking && 'bg-white/10 text-ink-900')}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
        </button>
        {picking && (
          <div className="kamby-glass-solid absolute bottom-full right-2 z-10 mb-2 w-64 rounded-2xl p-3">
            <p className="mb-2 font-body text-xs text-ink-400">{t('customize')}</p>
            <div className="grid grid-cols-8 gap-1">
              {TOKEN_CHAT_REACTIONS.map((emoji) => {
                const on = picks.includes(emoji);
                return (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setPicks(on ? (picks.length > 1 ? picks.filter((e) => e !== emoji) : picks) : [...picks.slice(1), emoji].slice(-4))}
                    className={cn('flex h-7 w-7 items-center justify-center rounded-lg text-base', on ? 'bg-accent/20 ring-1 ring-accent' : 'hover:bg-white/5')}
                    aria-pressed={on}
                  >
                    {emoji}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className={cn('px-2 pb-2 pt-1.5', phone && 'pb-[calc(env(safe-area-inset-bottom)+6rem)]')}>
        {!ready ? null : !authenticated ? (
          <button type="button" onClick={() => login()} className="h-10 w-full rounded-2xl bg-accent font-display text-sm font-bold text-black">
            {tAuth('signIn')} — {tP('toChat')}
          </button>
        ) : username === undefined ? null : !canPost ? (
          <ChatUsernameSetup onDone={setUsername} />
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendMessage();
              }}
              className="flex items-center gap-1.5"
            >
              {position && (
                <button
                  type="button"
                  onClick={() => void flexPnl()}
                  disabled={sending}
                  title={t('flexPnl')}
                  aria-label={t('flexPnl')}
                  className="flex h-10 shrink-0 items-center gap-1 rounded-full bg-surface-raised px-3 font-display text-xs font-bold text-accent disabled:opacity-40"
                >
                  <TrendingUp className="h-4 w-4" aria-hidden />
                  PnL
                </button>
              )}
              <input
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.slice(0, PULSE_LIMITS.maxLength));
                  setError(null);
                }}
                placeholder={t('placeholder', { symbol: symbol ?? '' })}
                aria-label={t('placeholder', { symbol: symbol ?? '' })}
                enterKeyHint="send"
                className="h-10 min-w-0 flex-1 rounded-full bg-surface-raised px-4 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label={tP('send')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-black transition-transform active:scale-95 disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" aria-hidden />
              </button>
            </form>
            {(error || draft.length > PULSE_LIMITS.maxLength - 40) && (
              <p className={cn('mt-1 px-2 font-body text-[0.7rem]', error ? 'text-down' : 'text-ink-400')}>{error ?? tP('charsLeft', { n: String(left) })}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const ChatRow = memo(function ChatRow({
  item,
  selected,
  reported,
  onSelect,
  onReport,
}: {
  item: TokenChatItem;
  selected: boolean;
  reported: boolean;
  onSelect: (id: string) => void;
  onReport: ((id: string) => void) | null;
}) {
  const t = useTranslations('tokenChat');
  const tP = useTranslations('pulse');
  const name = item.author.username ? `@${item.author.username}` : tP('trader');
  const nameEl = item.author.address ? (
    <Link href={`/trader/${item.author.address}`} className="font-display font-semibold text-ink-900 hover:text-accent">
      {name}
    </Link>
  ) : (
    <span className="font-display font-semibold text-ink-900">{name}</span>
  );

  if (item.kind === 'trade') {
    const buy = item.side === 'BUY';
    const size = item.usd >= 1_000 ? '🐳' : item.usd >= 100 ? '🦈' : null;
    return (
      <li className="kamby-chat-in flex items-center gap-1.5 px-1 font-body text-xs text-ink-400">
        <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold', buy ? 'bg-up/15 text-up' : 'bg-down/15 text-down')} aria-hidden>
          {buy ? '▲' : '▼'}
        </span>
        <span className="min-w-0 truncate">
          {nameEl} {buy ? t('bought') : t('sold')}{' '}
          <span className={cn('font-semibold tabular-nums', buy ? 'text-up' : 'text-down')}>{money(item.usd)}</span>
          {size && <span className="ml-1">{size}</span>}
        </span>
      </li>
    );
  }

  const badges = item.badges.map((b) => (
    <span key={b} title={t(`badge_${b}`)} className="ml-0.5 text-xs">
      {BADGE_ICON[b]}
    </span>
  ));

  if (item.kind === 'pnl') {
    const up = item.pnl.pnlUsd >= 0;
    return (
      <li className="kamby-chat-in py-0.5">
        <div className="flex items-baseline gap-1 px-1 font-body text-xs text-ink-400">
          {nameEl}
          {badges}
        </div>
        <div className={cn('mt-1 flex items-center gap-3 rounded-2xl border px-3 py-2', up ? 'border-up/25 bg-up/[0.07]' : 'border-down/25 bg-down/[0.07]')}>
          <TokenAvatar src={item.pnl.logoUrl} seed={item.tokenKey} label={item.pnl.symbol} className="h-8 w-8 shrink-0 text-xs" />
          <div className="min-w-0 flex-1">
            <p className={cn('font-display text-xl font-black leading-none tabular-nums', up ? 'text-up' : 'text-down')}>{pct(item.pnl.pnlPct) ?? money(item.pnl.pnlUsd)}</p>
            <p className="mt-1 truncate font-body text-[0.7rem] tabular-nums text-ink-400">
              {money(item.pnl.investedUsd)} → <span className="text-ink-900">{money(item.pnl.valueUsd)}</span>
            </p>
          </div>
          <p className={cn('shrink-0 font-display text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>
            {up ? '+' : '-'}
            {money(Math.abs(item.pnl.pnlUsd))}
          </p>
        </div>
      </li>
    );
  }

  return (
    <li className="kamby-chat-in group relative">
      {/* A tap shows "Report" (a div, not a button: the name inside is a link). */}
      <div onClick={() => onSelect(item.id)} className="cursor-default rounded-lg px-1 py-0.5 hover:bg-white/[0.03]">
        <p className={cn('break-words font-body text-sm leading-snug text-ink-700', reported && 'opacity-40')}>
          <span className="mr-1 inline-flex items-baseline">
            {nameEl}
            {badges}
          </span>
          <Body text={item.body} />
        </p>
      </div>
      {onReport && (selected || reported) && (
        <button
          type="button"
          disabled={reported}
          onClick={() => onReport(item.id)}
          className="absolute right-1 top-0.5 flex items-center gap-1 rounded-full bg-surface-raised px-2 py-0.5 font-body text-[0.65rem] text-ink-400 hover:text-down disabled:opacity-60"
        >
          <Flag className="h-3 w-3" aria-hidden />
          {reported ? t('reported') : t('report')}
        </button>
      )}
    </li>
  );
});
