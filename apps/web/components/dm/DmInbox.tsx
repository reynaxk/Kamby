'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DmConversation } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { fetchConversations, openConversation, useDmUnread } from '@/lib/dm-client';
import { subscribePrivateStream } from '@/lib/private-stream';
import { hasStoredSession } from '@/lib/session-client';
import { friendlyError } from '@/lib/friendly-error';
import { formatRelativeTime } from '@/lib/format';
import { fetchPeopleResults, type PersonResult } from '@/lib/market-client';
import { useMyUsername } from '@/lib/use-my-username';
import { DmAvatar } from './DmAvatar';
import { GroupAvatar, NewGroupDrawer } from './GroupBits';
import { CommunityAvatar, CommunityRail, NewCommunityDrawer } from './CommunityBits';

/**
 * The Messages screen (2026-10-17): your chats, newest first, and a Requests tab for first
 * messages from people you don't both follow (Instagram-style). A frosted "new message" field
 * opens a chat by @username. Updates live from the private stream.
 */
export function DmInbox() {
  const t = useTranslations('dm');
  const tU = useTranslations('ui');
  const router = useRouter();
  const pathname = usePathname();
  const unread = useDmUnread();
  const [box, setBox] = useState<'chats' | 'requests'>('chats');
  const [items, setItems] = useState<DmConversation[] | null>(null);
  const [error, setError] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [composing, setComposing] = useState(false);
  const [username, setUsername] = useState('');
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [myName] = useMyUsername(true);
  // People as you type (2026-10-18: the field only worked if you knew the exact @name).
  const [people, setPeople] = useState<PersonResult[] | null>(null);
  useEffect(() => {
    const q = username.trim().replace(/^@/, '');
    if (!composing || q.length < 2) {
      setPeople(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchPeopleResults(q, 6)
        .then((rows) => {
          if (cancelled) return;
          // One row per name; only people with a Kamby name can be messaged.
          const seen = new Set<string>();
          setPeople(rows.filter((r) => r.username && r.username !== myName && !seen.has(r.username) && seen.add(r.username)));
        })
        .catch(() => !cancelled && setPeople([]));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [username, composing, myName]);
  const [groupOpen, setGroupOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(false);

  const load = useCallback(() => {
    fetchConversations(box)
      .then((rows) => {
        setItems(rows);
        setError(false);
      })
      .catch(() => setError(true));
  }, [box]);

  useEffect(() => {
    const ok = hasStoredSession();
    setSignedIn(ok);
    if (!ok) return;
    setItems(null);
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribePrivateStream({
      onDm: (e) => {
        if (e.type === 'typing') return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(load, 300);
      },
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  async function start(e: React.FormEvent | null, pick?: string) {
    e?.preventDefault();
    const name = (pick ?? username).trim().replace(/^@/, '');
    if (name.length < 3) return;
    setOpening(true);
    setOpenError(null);
    try {
      const chat = await openConversation(name);
      router.push(`/messages/${chat.id}`);
    } catch (err) {
      setOpenError(friendlyError(err));
      setOpening(false);
    }
  }

  if (signedIn === false) {
    return (
      <div className="kamby-glass mt-6 rounded-3xl px-6 py-12 text-center">
        <p className="font-display text-lg font-bold text-ink-900">{t('signInTitle')}</p>
        <p className="mt-1 font-body text-sm text-ink-400">{t('signInBody')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* New message */}
      {composing ? (
        <form onSubmit={start} className="kamby-glass-solid flex items-center gap-2 rounded-2xl p-1.5 pl-4">
          <span className="font-display text-base font-bold text-accent">@</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').slice(0, 21))}
            placeholder={t('toPlaceholder')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-2 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          {/* An arrow, not the word "Chat" (owner, 2026-10-18: it read like a label, not a button). */}
          <button
            type="submit"
            aria-label={t('newMessage')}
            disabled={opening || username.trim().length < 3}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-black transition-transform active:scale-95 disabled:opacity-30"
          >
            {opening ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden />
            ) : (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label={tU('close_d3d2')}
            onClick={() => {
              setComposing(false);
              setUsername('');
              setOpenError(null);
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-400 hover:text-ink-900"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </form>
      ) : null}
      {composing && people !== null && (
        <div className="kamby-glass-solid mt-2 overflow-hidden rounded-2xl">
          {people.length === 0 ? (
            <p className="px-4 py-3 font-body text-sm text-ink-400">{t('noPeople')}</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {people.map((p) => (
                <li key={p.username}>
                  <button
                    type="button"
                    disabled={opening}
                    onClick={() => void start(null, p.username!)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06] disabled:opacity-50"
                  >
                    <DmAvatar name={p.username} src={p.avatarUrl} className="h-9 w-9 text-sm" />
                    <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">@{p.username}</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-ink-400">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {composing ? null : (
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="kamby-glass flex flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center transition-transform active:scale-[0.98]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="w-full truncate whitespace-nowrap font-display text-[0.8rem] font-bold text-ink-900">{t('newMessage')}</span>
          </button>
          <button
            type="button"
            onClick={() => setGroupOpen(true)}
            className="kamby-glass flex flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center transition-transform active:scale-[0.98]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8" />
              </svg>
            </span>
            <span className="w-full truncate whitespace-nowrap font-display text-[0.8rem] font-bold text-ink-900">{t('newGroup')}</span>
          </button>
          <button
            type="button"
            onClick={() => setCommunityOpen(true)}
            className="kamby-glass flex flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center transition-transform active:scale-[0.98]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/[0.08] font-display text-lg font-black text-accent" aria-hidden>
              #
            </span>
            <span className="w-full truncate whitespace-nowrap font-display text-[0.8rem] font-bold text-ink-900">{t('communityBadge')}</span>
          </button>
        </div>
      )}
      <NewGroupDrawer open={groupOpen} onClose={() => setGroupOpen(false)} />
      <NewCommunityDrawer open={communityOpen} onClose={() => setCommunityOpen(false)} />
      {openError && <p className="mt-2 px-1 font-body text-xs font-semibold text-down">{openError}</p>}

      {box === 'chats' && items && items.some((c) => c.group?.community) && (
        <CommunityRail items={items.filter((c) => c.group?.community)} onCreate={() => setCommunityOpen(true)} />
      )}

      {/* Chats / Requests */}
      <div className="mt-5 flex gap-1 rounded-full bg-white/[0.04] p-1" role="tablist">
        {(['chats', 'requests'] as const).map((b) => (
          <button
            key={b}
            type="button"
            role="tab"
            aria-selected={box === b}
            onClick={() => setBox(b)}
            className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 font-display text-sm font-bold transition-colors', box === b ? 'bg-white/10 text-ink-900' : 'text-ink-400')}
          >
            {t(b)}
            {b === 'requests' && (unread?.requests ?? 0) > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-body text-[0.6rem] font-bold text-black">{unread!.requests}</span>
            )}
          </button>
        ))}
      </div>
      {box === 'requests' && <p className="mt-3 px-1 font-body text-xs text-ink-400">{t('requestsNote')}</p>}

      <ul className="mt-3 flex flex-col">
        {items === null && !error
          ? [0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 px-1 py-3">
                <span className="h-12 w-12 animate-pulse rounded-full bg-white/[0.05]" />
                <span className="flex-1 space-y-2">
                  <span className="block h-3 w-28 animate-pulse rounded-full bg-white/[0.06]" />
                  <span className="block h-2.5 w-44 animate-pulse rounded-full bg-white/[0.04]" />
                </span>
              </li>
            ))
          : null}
        {error && <li className="px-1 py-6 text-center font-body text-sm text-ink-400">{t('loadError')}</li>}
        {items?.length === 0 && (
          <li className="kamby-glass mt-2 flex flex-col items-center rounded-3xl px-6 py-12 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/[0.08] text-accent" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
              </svg>
            </span>
            <p className="mt-4 font-display text-base font-bold text-ink-900">{box === 'chats' ? t('emptyChats') : t('emptyRequests')}</p>
            <p className="mt-1 font-body text-sm text-ink-400">{box === 'chats' ? t('emptyChatsBody') : t('emptyRequestsBody')}</p>
          </li>
        )}
        {items?.map((c) => {
          const name = c.group ? c.group.title : c.other?.username ? `@${c.other.username}` : t('someone');
          const mine = c.lastMessage?.senderId === c.meId;
          const sender = c.group && c.lastMessage && !mine && c.lastMessage.kind !== 'system' ? c.group.members.find((m) => m.userId === c.lastMessage!.senderId)?.username : null;
          return (
            <li key={c.id}>
              <Link
                href={`/messages/${c.id}`}
                className={cn('flex items-center gap-3 rounded-2xl px-1 py-2.5 transition-colors active:bg-white/[0.04] md:px-2 md:hover:bg-white/[0.04]', pathname === `/messages/${c.id}` && 'bg-white/[0.07] md:hover:bg-white/[0.07]')}
              >
                <span className="relative">
                  {c.group?.community ? <CommunityAvatar title={c.group.title} /> : c.group ? <GroupAvatar members={c.group.members} meId={c.meId} /> : <DmAvatar name={c.other?.username ?? null} src={c.other?.avatarUrl ?? null} />}
                  {c.unread > 0 && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg bg-accent" aria-hidden />}
                  {!c.group && (c.onlineIds?.length ?? 0) > 0 && <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg bg-up" aria-label={t('activeNow')} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={cn('truncate font-display text-[0.95rem] text-ink-900', c.unread > 0 ? 'font-black' : 'font-bold')}>{name}</span>
                    {c.group?.community && <span className="shrink-0 rounded-full border border-accent/20 bg-accent/[0.08] px-2 py-0.5 font-body text-[0.6rem] font-bold text-accent">{t('communityBadge')}</span>}
                    {c.mute && (
                      <span className="shrink-0 text-xs text-ink-400" aria-label={t('muted')}>
                        🔕
                      </span>
                    )}
                    {c.state === 'pending' && <span className="shrink-0 rounded-full bg-white/[0.07] px-2 py-0.5 font-body text-[0.6rem] font-semibold text-ink-400">{t('pending')}</span>}
                    {c.blocked && <span className="shrink-0 rounded-full bg-down/10 px-2 py-0.5 font-body text-[0.6rem] font-semibold text-down">{t('blocked')}</span>}
                  </span>
                  <span className={cn('mt-0.5 block truncate font-body text-sm', c.unread > 0 ? 'font-semibold text-ink-900' : 'text-ink-400')}>
                    {c.lastMessage ? `${mine && c.lastMessage.kind !== 'system' ? `${t('you')}: ` : sender ? `${sender}: ` : ''}${c.lastMessage.body}` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {c.lastMessage && <span className="font-body text-[0.68rem] text-ink-400">{formatRelativeTime(c.lastMessage.createdAt)}</span>}
                  {c.unread > 0 && (
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 font-body text-[0.65rem] font-bold text-black">{c.unread > 99 ? '99+' : c.unread}</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
