'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DM_LIMITS, slugForIdentifier, type DmConversation, type DmMessage, type MarketSummary, type TokenPosition } from '@kamby/domain';
import { cn } from '@kamby/ui';
import {
  acceptConversation,
  blockConversation,
  fetchConversation,
  fetchDmMessages,
  hideConversation,
  markDmRead,
  reactToDm,
  reportConversation,
  sendDmCoin,
  sendDmPnl,
  sendDmText,
  sendDmTyping,
  sendDmUsdc,
} from '@/lib/dm-client';
import { subscribePrivateStream } from '@/lib/private-stream';
import { friendlyError } from '@/lib/friendly-error';
import { fetchSearchResults } from '@/lib/market-client';
import { fetchMyPositions } from '@/lib/discovery-client';
import { cashtag, formatPercent } from '@/lib/format';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { SendModal } from '@/components/wallet/SendModal';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { DmAvatar } from './DmAvatar';
import { DmMessageView } from './DmMessageView';

/** The API's chain words for a coin's chain. */
function chainSlug(chainIdentifier: string): string | null {
  if (chainIdentifier === 'solana') return 'solana';
  return slugForIdentifier(chainIdentifier);
}

function dayLabel(iso: string, t: (k: string) => string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t('today');
  if (d.toDateString() === yesterday.toDateString()) return t('yesterday');
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * One private chat (2026-10-17). Live from the private stream: new lines, "typing…", "Seen",
 * reactions. A request from someone you don't both follow shows Accept / Delete / Block before
 * you can answer. The + menu shares a coin, your real PnL on a coin you hold, or sends USDC.
 */
export function DmThread({ id }: { id: string }) {
  const t = useTranslations('dm');
  const router = useRouter();
  const [conv, setConv] = useState<DmConversation | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [menu, setMenu] = useState(false);
  const [attach, setAttach] = useState<'menu' | 'coin' | 'pnl' | null>(null);
  const [usdcOpen, setUsdcOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const stickToBottom = useRef(true);

  const otherId = conv?.other.userId ?? null;
  const me = useMemo(() => messages.find((m) => m.senderId !== otherId)?.senderId ?? null, [messages, otherId]);

  const refreshConv = useCallback(() => {
    fetchConversation(id)
      .then(setConv)
      .catch(() => undefined);
  }, [id]);

  // First load.
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchConversation(id), fetchDmMessages(id)])
      .then(([c, page]) => {
        if (cancelled) return;
        setConv(c);
        setMessages([...page.items].reverse());
        setNextBefore(page.nextBefore);
        if (c.unread > 0) void markDmRead(id).catch(() => undefined);
      })
      .catch((err: unknown) => !cancelled && setLoadError(friendlyError(err)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Live.
  useEffect(() => {
    let readTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePrivateStream({
      onDm: (e) => {
        if (e.conversationId !== id) return;
        if (e.type === 'message') {
          setMessages((list) => (list.some((m) => m.id === e.message.id) ? list : [...list, e.message]));
          setTyping(false);
          if (e.message.senderId === otherId && document.visibilityState === 'visible') {
            if (readTimer) clearTimeout(readTimer);
            readTimer = setTimeout(() => void markDmRead(id).catch(() => undefined), 500);
          }
        } else if (e.type === 'typing') {
          setTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), DM_LIMITS.typingTtlMs);
        } else if (e.type === 'read') {
          if (e.userId === otherId) setConv((c) => (c ? { ...c, otherReadAt: e.atIso } : c));
        } else if (e.type === 'reaction') {
          setMessages((list) => list.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)));
        } else if (e.type === 'state') {
          refreshConv();
        }
      },
    });
    return () => {
      if (readTimer) clearTimeout(readTimer);
      unsubscribe();
    };
  }, [id, otherId, refreshConv]);

  // Stay at the bottom as lines arrive (unless you scrolled up to read).
  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, typing]);

  async function loadEarlier() {
    if (!nextBefore) return;
    stickToBottom.current = false;
    const page = await fetchDmMessages(id, nextBefore).catch(() => null);
    if (!page) return;
    setMessages((list) => [...[...page.items].reverse(), ...list]);
    setNextBefore(page.nextBefore);
  }

  async function run(send: () => Promise<DmMessage>) {
    setSending(true);
    setSendError(null);
    stickToBottom.current = true;
    try {
      const m = await send();
      setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]));
      if (conv?.state === 'request') refreshConv();
      return true;
    } catch (err) {
      setSendError(friendlyError(err));
      return false;
    } finally {
      setSending(false);
    }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    if (await run(() => sendDmText(id, body))) setText('');
  }

  function onType(value: string) {
    setText(value.slice(0, DM_LIMITS.maxLength));
    if (Date.now() - lastTypingSent.current > 2500 && value.trim()) {
      lastTypingSent.current = Date.now();
      void sendDmTyping(id);
    }
  }

  async function react(messageId: string, emoji: string) {
    const reactions = await reactToDm(messageId, emoji).catch(() => null);
    if (reactions) setMessages((list) => list.map((m) => (m.id === messageId ? { ...m, reactions } : m)));
  }

  async function accept() {
    const c = await acceptConversation(id).catch(() => null);
    if (c) setConv(c);
  }
  async function remove() {
    await hideConversation(id).catch(() => undefined);
    router.push('/messages');
  }
  async function toggleBlock() {
    if (!conv) return;
    const c = await blockConversation(id, !conv.blocked).catch(() => null);
    if (c) setConv(c);
    setMenu(false);
  }
  async function report() {
    if (!window.confirm(t('reportConfirm'))) return;
    await reportConversation(id).catch(() => undefined);
    setMenu(false);
    refreshConv();
  }

  if (loadError) {
    return <p className="px-4 py-16 text-center font-body text-sm text-ink-400">{loadError}</p>;
  }

  const name = conv?.other.username ? `@${conv.other.username}` : '…';
  const lastMine = [...messages].reverse().find((m) => m.senderId !== otherId);
  const seen = lastMine && conv?.otherReadAt && new Date(conv.otherReadAt) >= new Date(lastMine.createdAt);
  const canWrite = conv && !conv.blocked && conv.state !== 'request';

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Header */}
      <header className="kamby-frost-bar-phone sticky top-0 z-30 flex items-center gap-2 border-b border-white/[0.05] px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:bg-bg/90">
        <button
          type="button"
          aria-label={t('back')}
          onClick={() => (window.history.length > 1 ? router.back() : router.push('/messages'))}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        {conv?.other.walletAddress ? (
          <Link href={`/trader/${conv.other.walletAddress}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <DmAvatar name={conv.other.username} src={conv.other.avatarUrl} className="h-9 w-9 text-sm" />
            <span className="truncate font-display text-base font-bold text-ink-900">{name}</span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <DmAvatar name={conv?.other.username ?? null} src={conv?.other.avatarUrl ?? null} className="h-9 w-9 text-sm" />
            <span className="truncate font-display text-base font-bold text-ink-900">{name}</span>
          </span>
        )}
        <span className="relative">
          <button type="button" aria-label={t('more')} onClick={() => setMenu((m) => !m)} className="flex h-10 w-10 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menu && (
            <div className="kamby-glass-solid absolute right-0 top-11 z-40 w-48 overflow-hidden rounded-2xl py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]" role="menu">
              <button type="button" onClick={() => void toggleBlock()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10">
                {conv?.blocked ? t('unblock') : t('block')}
              </button>
              <button type="button" onClick={() => void report()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-down active:bg-white/10">
                {t('report')}
              </button>
              <button type="button" onClick={() => void remove()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-600 active:bg-white/10">
                {t('deleteChat')}
              </button>
            </div>
          )}
        </span>
      </header>

      {/* Messages */}
      <main className="mx-auto w-full max-w-2xl flex-1 px-3 pb-36 pt-3">
        {nextBefore && (
          <button type="button" onClick={() => void loadEarlier()} className="mx-auto mb-2 block rounded-full bg-white/[0.05] px-4 py-1.5 font-body text-xs font-semibold text-ink-400">
            {t('loadEarlier')}
          </button>
        )}
        {conv && messages.length === 0 && (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <DmAvatar name={conv.other.username} src={conv.other.avatarUrl} className="h-20 w-20 text-2xl" />
            <p className="mt-3 font-display text-lg font-bold text-ink-900">{name}</p>
            <p className="mt-1 font-body text-sm text-ink-400">{t('sayHi')}</p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const first = newDay || prev?.senderId !== m.senderId || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
          const last = !next || next.senderId !== m.senderId || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
          return (
            <div key={m.id}>
              {newDay && <p className="my-4 text-center font-body text-[0.68rem] font-semibold uppercase tracking-wider text-ink-400">{dayLabel(m.createdAt, t)}</p>}
              <DmMessageView m={m} mine={m.senderId !== otherId} me={me} first={first} last={last} onReact={(mid, e) => void react(mid, e)} />
            </div>
          );
        })}
        {seen && <p className="mr-2 mt-1 text-right font-body text-[0.68rem] text-ink-400">{t('seen')}</p>}
        {typing && (
          <div className="mt-2 flex items-center gap-2">
            <span className="kamby-glass flex items-center gap-1 rounded-3xl px-4 py-3" aria-label={t('typing', { name })}>
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {/* Bottom: request choice, blocked note, or the composer */}
      <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 md:mx-auto md:max-w-2xl">
        {conv?.state === 'request' && !conv.blocked ? (
          <div className="kamby-glass-solid rounded-3xl p-4 text-center">
            <p className="font-display text-sm font-bold text-ink-900">{t('requestTitle', { name })}</p>
            <p className="mt-1 font-body text-xs text-ink-400">{t('requestBody')}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => void toggleBlock()} className="rounded-2xl bg-down/10 py-2.5 font-display text-sm font-bold text-down">
                {t('block')}
              </button>
              <button type="button" onClick={() => void remove()} className="rounded-2xl bg-white/[0.06] py-2.5 font-display text-sm font-bold text-ink-900">
                {t('delete')}
              </button>
              <button type="button" onClick={() => void accept()} className="rounded-2xl bg-accent py-2.5 font-display text-sm font-bold text-black">
                {t('accept')}
              </button>
            </div>
          </div>
        ) : conv?.blocked ? (
          <div className="kamby-glass-solid rounded-3xl p-4 text-center">
            <p className="font-body text-sm text-ink-400">{t('blockedNote', { name })}</p>
            <button type="button" onClick={() => void toggleBlock()} className="mt-2 font-display text-sm font-bold text-accent">
              {t('unblock')}
            </button>
          </div>
        ) : (
          <>
            {conv?.state === 'pending' && <p className="mb-2 px-2 text-center font-body text-[0.7rem] text-ink-400">{t('pendingNote', { max: DM_LIMITS.requestMessagesMax })}</p>}
            {sendError && <p className="mb-2 px-2 text-center font-body text-xs font-semibold text-down">{sendError}</p>}
            <form onSubmit={(e) => void submit(e)} className="kamby-glass-solid kamby-glass-dense flex items-end gap-1.5 rounded-[1.6rem] p-1.5 shadow-[0_10px_36px_rgba(0,0,0,0.6)]">
              <button
                type="button"
                aria-label={t('attach')}
                disabled={!canWrite}
                onClick={() => setAttach('menu')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/[0.12] text-accent transition-transform active:scale-90 disabled:opacity-40"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <textarea
                value={text}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                disabled={!canWrite}
                placeholder={t('placeholder')}
                className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 font-body text-[0.95rem] leading-snug text-ink-900 placeholder:text-ink-400 focus:outline-none [field-sizing:content]"
              />
              <button
                type="submit"
                aria-label={t('send')}
                disabled={!canWrite || sending || !text.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-black transition-transform active:scale-90 disabled:opacity-30"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </button>
            </form>
          </>
        )}
      </div>

      {/* + menu */}
      <MobileDrawer open={attach === 'menu'} onClose={() => setAttach(null)} title={t('attachTitle')} desktop>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {(
            [
              ['coin', '🪙', t('attachCoin')],
              ['pnl', '📈', t('attachPnl')],
              ['usdc', '💸', t('attachUsdc')],
            ] as const
          ).map(([key, icon, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === 'usdc') {
                  setAttach(null);
                  setUsdcOpen(true);
                } else setAttach(key);
              }}
              className="kamby-glass flex flex-col items-center gap-2 rounded-3xl px-2 py-4 transition-transform active:scale-95"
            >
              <span className="text-2xl" aria-hidden>
                {icon}
              </span>
              <span className="font-display text-xs font-bold text-ink-900">{label}</span>
            </button>
          ))}
        </div>
      </MobileDrawer>
      <CoinPicker
        open={attach === 'coin'}
        onClose={() => setAttach(null)}
        onPick={(m) => {
          setAttach(null);
          const slug = chainSlug(m.chainIdentifier);
          if (slug) void run(() => sendDmCoin(id, slug, m.tokenAddress));
        }}
      />
      <PnlPicker
        open={attach === 'pnl'}
        onClose={() => setAttach(null)}
        onPick={(p) => {
          setAttach(null);
          const slug = chainSlug(p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : ''));
          if (slug) void run(() => sendDmPnl(id, slug, p.tokenAddress));
        }}
      />
      {conv?.other.username && (
        <SendModal
          open={usdcOpen}
          onClose={() => setUsdcOpen(false)}
          toUser
          presetUsername={conv.other.username}
          onSent={(txRef, slug) => void run(() => sendDmUsdc(id, slug, txRef))}
        />
      )}
    </div>
  );
}

function CoinPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (m: MarketSummary) => void }) {
  const t = useTranslations('dm');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MarketSummary[]>([]);
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchSearchResults(term, 8)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => undefined);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, open]);
  return (
    <MobileDrawer open={open} onClose={onClose} title={t('attachCoin')} desktop>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('coinSearch')}
        className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />
      <ul className="mt-2 max-h-[50vh] overflow-y-auto">
        {results.map((m) => {
          const chain = badgeChainFor(m.chainIdentifier);
          return (
            <li key={`${m.chainIdentifier}:${m.tokenAddress}`}>
              <button type="button" onClick={() => onPick(m)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left active:bg-white/[0.05]">
                <span className="relative shrink-0">
                  <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol ?? m.tokenAddress} className="h-9 w-9 text-xs" />
                  {chain && <ChainBadge chain={chain} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))}</span>
                  <span className="block truncate font-body text-xs text-ink-400">{m.name ?? ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileDrawer>
  );
}

function PnlPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: TokenPosition) => void }) {
  const t = useTranslations('dm');
  const [positions, setPositions] = useState<TokenPosition[] | null>(null);
  useEffect(() => {
    if (!open) return;
    fetchMyPositions()
      .then((rows) => setPositions(rows.filter((p) => p.currentValueUsd !== null && p.costBasisUsd > 0)))
      .catch(() => setPositions([]));
  }, [open]);
  return (
    <MobileDrawer open={open} onClose={onClose} title={t('attachPnl')} desktop>
      {positions?.length === 0 && <p className="py-6 text-center font-body text-sm text-ink-400">{t('noPositions')}</p>}
      <ul className="max-h-[50vh] overflow-y-auto">
        {positions?.map((p) => {
          const up = (p.unrealizedPnlUsd ?? 0) >= 0;
          return (
            <li key={`${p.chainIdentifier ?? p.chain}:${p.tokenAddress}`}>
              <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left active:bg-white/[0.05]">
                <TokenAvatar src={p.logoUrl} seed={p.tokenAddress} label={p.symbol ?? p.tokenAddress} className="h-9 w-9 text-xs" />
                <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">{cashtag(p.symbol ?? p.tokenAddress.slice(0, 6))}</span>
                <span className={cn('font-display text-sm font-bold tabular-nums', up ? 'text-up' : 'text-down')}>{p.unrealizedPnlPct !== null ? formatPercent(p.unrealizedPnlPct) : '—'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileDrawer>
  );
}
