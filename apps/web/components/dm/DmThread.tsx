'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DM_LIMITS, slugForIdentifier, type DmConversation, type DmMessage, type MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import {
  acceptConversation,
  blockConversation,
  fetchConversation,
  fetchDmMessages,
  hideConversation,
  leaveGroup,
  removeGroupMember,
  renameGroup,
  markDmRead,
  reactToDm,
  reportConversation,
  sendDmCoin,
  sendDmPnl,
  sendDmTrade,
  sendDmVoice,
  fetchDmCapabilities,
  sendDmText,
  sendDmTyping,
  sendDmUsdc,
} from '@/lib/dm-client';
import { subscribePrivateStream } from '@/lib/private-stream';
import { friendlyError } from '@/lib/friendly-error';
import { fetchSearchResults } from '@/lib/market-client';
import { cashtag } from '@/lib/format';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { SendModal } from '@/components/wallet/SendModal';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { DmAvatar } from './DmAvatar';
import { DmMessageView } from './DmMessageView';
import { AddPeopleDrawer, GroupAvatar } from './GroupBits';
import { MuteDrawer } from './MuteDrawer';
import { VoiceRecorderButton } from './Voice';
import { ChallengeSheet } from '@/components/duels/ChallengeSheet';
import { ChannelBar, ChannelsDrawer, CommunityAvatar, CommunityHome, CommunityPanel, InviteDrawer, SquadSettingsDrawer } from './CommunityBits';
import { haptic, nameColor } from './DmMessageView';
import { PositionPicker } from '@/components/social/PositionPicker';
import { useCalls } from '@/components/calls/CallProvider';
import { fetchCall } from '@/lib/calls-client';
import type { CallState } from '@kamby/domain';

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
  const [typing, setTyping] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [adding, setAdding] = useState(false);
  const calls = useCalls();
  // A call already going when this chat opened (e.g. you came in from the ring push).
  const [serverCall, setServerCall] = useState<CallState | null>(null);
  useEffect(() => {
    fetchCall(id)
      .then(setServerCall)
      .catch(() => undefined);
  }, [id]);
  const [menu, setMenu] = useState(false);
  const [attach, setAttach] = useState<'menu' | 'coin' | 'pnl' | 'trade' | 'duel' | null>(null);
  const [usdcOpen, setUsdcOpen] = useState(false);
  // Communities: the text channel you're reading, and the owner's channel / invite sheets.
  const [channelId, setChannelId] = useState<string | null>(null);
  const channelRef = useRef<string | null>(null);
  channelRef.current = channelId;
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const channelCache = useRef(new Map<string, { messages: DmMessage[]; nextBefore: string | null }>());
  const [homeOpen, setHomeOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const [squadOpen, setSquadOpen] = useState(false);
  // 🎙️ Voice notes show up once storage is switched on for this deployment.
  const [voiceOn, setVoiceOn] = useState(false);
  useEffect(() => {
    void fetchDmCapabilities().then((c) => setVoiceOn(c.voice));
  }, []);
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Where the unread lines start when you opened the chat ("New messages" divider), and how many
  // arrived below while you were scrolled up (the jump pill).
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const stickToBottom = useRef(true);

  const me = conv?.meId ?? null;
  const isGroup = Boolean(conv?.group);
  const community = conv?.group?.community ?? null;
  const channelName = community?.channels.find((c) => c.id === channelId)?.name ?? null;
  const memberBy = useMemo(() => new Map((conv?.group?.members ?? []).map((p) => [p.userId, p])), [conv]);

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
        setChannelId(c.group?.community?.channels.find((ch) => ch.kind === 'text')?.id ?? null);
        const list = [...page.items].reverse();
        setMessages(list);
        setNextBefore(page.nextBefore);
        if (c.unread > 0) {
          const theirs = list.filter((m) => m.senderId !== c.meId && m.kind !== 'system');
          if (c.unread < theirs.length) setFirstUnreadId(theirs[theirs.length - c.unread]?.id ?? null);
          void markDmRead(id).catch(() => undefined);
        }
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
          const ch = e.message.channelId;
          if (ch && channelRef.current && ch !== channelRef.current) return;
          setMessages((list) => (list.some((m) => m.id === e.message.id) ? list : [...list, e.message]));
          if (!stickToBottom.current && e.message.senderId !== me) setNewBelow((n) => n + 1);
          setTyping(null);
          if (e.message.senderId !== me && e.message.kind !== 'system' && document.visibilityState === 'visible') {
            if (readTimer) clearTimeout(readTimer);
            readTimer = setTimeout(() => void markDmRead(id).catch(() => undefined), 500);
          }
        } else if (e.type === 'typing') {
          setTyping(e.userId);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(null), DM_LIMITS.typingTtlMs);
        } else if (e.type === 'read') {
          if (e.userId !== me) setConv((c) => (c ? { ...c, otherReadAt: e.atIso } : c));
        } else if (e.type === 'reaction') {
          setMessages((list) => list.map((m) => (m.id === e.messageId ? { ...m, reactions: e.reactions } : m)));
        } else if (e.type === 'state') {
          refreshConv();
        } else if (e.type === 'call') {
          setServerCall(e.call);
        }
      },
    });
    return () => {
      if (readTimer) clearTimeout(readTimer);
      unsubscribe();
    };
  }, [id, me, refreshConv]);

  // Stay at the bottom as lines arrive (unless you scrolled up to read).
  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
      setScrolledUp(window.innerHeight + window.scrollY < document.body.scrollHeight - 600);
      if (stickToBottom.current) setNewBelow(0);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, typing]);
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) bottomRef.current?.scrollIntoView({ block: 'end' });
    });
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  function pickChannel(next: string) {
    if (next === channelId) return;
    haptic();
    setFirstUnreadId(null);
    setReplyTo(null);
    if (channelId) channelCache.current.set(channelId, { messages, nextBefore });
    const cached = channelCache.current.get(next);
    setChannelId(next);
    setMessages(cached?.messages ?? []);
    setNextBefore(cached?.nextBefore ?? null);
    stickToBottom.current = true;
    void fetchDmMessages(id, undefined, next)
      .then((page) => {
        if (channelRef.current !== next) return;
        setMessages([...page.items].reverse());
        setNextBefore(page.nextBefore);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!community) return;
    // In iPhone Safari the left-edge swipe is "Back" — only take it over in the installed app.
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) && !standalone) return;
    let startX = -1;
    let startY = 0;
    const down = (e: TouchEvent) => {
      const t0 = e.touches[0];
      startX = t0 && t0.clientX < 28 ? t0.clientX : -1;
      startY = t0?.clientY ?? 0;
    };
    const move = (e: TouchEvent) => {
      const t0 = e.touches[0];
      if (startX < 0 || !t0) return;
      if (t0.clientX - startX > 60 && Math.abs(t0.clientY - startY) < 40) {
        startX = -1;
        haptic();
        setHomeOpen(true);
      }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    return () => {
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
    };
  }, [community]);

  function jumpToLatest() {
    stickToBottom.current = true;
    setNewBelow(0);
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  async function loadEarlier() {
    if (!nextBefore) return;
    stickToBottom.current = false;
    const page = await fetchDmMessages(id, nextBefore, channelId ?? undefined).catch(() => null);
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
    haptic();
    setFirstUnreadId(null);
    const answering = replyTo?.id;
    if (await run(() => sendDmText(id, body, channelId ?? undefined, answering))) {
      setText('');
      setReplyTo(null);
    }
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
  async function leave() {
    if (!window.confirm(t('leaveConfirm'))) return;
    await leaveGroup(id).catch(() => undefined);
    router.push('/messages');
  }
  async function kick(userId: string) {
    const c = await removeGroupMember(id, userId).catch(() => null);
    if (c) setConv(c);
  }
  async function rename() {
    const title = window.prompt(t('rename'), conv?.group?.title ?? '');
    if (!title?.trim()) return;
    const c = await renameGroup(id, title.trim()).catch(() => null);
    if (c) setConv(c);
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

  const name = conv?.group ? conv.group.title : conv?.other?.username ? `@${conv.other.username}` : '…';
  const lastMine = [...messages].reverse().find((m) => m.senderId === me);
  const seen = !isGroup && lastMine && conv?.otherReadAt && new Date(conv.otherReadAt) >= new Date(lastMine.createdAt);
  const canWrite = conv && !conv.blocked && conv.state !== 'request';
  const isOwner = Boolean(conv?.group && conv.group.ownerId === me);
  // Calls only in accepted chats (owner's rule 2026-10-17).
  const canCall = Boolean(conv && !conv.blocked && conv.state === 'active' && !calls.inCall);
  const liveCall = serverCall;
  const inLiveCall = Boolean(liveCall && me && liveCall.participants.some((p) => p.userId === me));
  const otherOnline = Boolean(conv && !conv.group && (conv.onlineIds?.length ?? 0) > 0);
  // @mention picker: typing "@ta" in a group offers its people (Discord / Telegram).
  const mentionQuery = isGroup ? (/(?:^|\s)@([a-z0-9_.]{0,21})$/i.exec(text)?.[1] ?? null) : null;
  const mentionPeople =
    mentionQuery === null
      ? []
      : (conv?.group?.members ?? [])
          .filter((p) => p.userId !== me && p.username && p.username.toLowerCase().startsWith(mentionQuery.toLowerCase()))
          .sort((a, b) => Number(conv?.onlineIds?.includes(b.userId)) - Number(conv?.onlineIds?.includes(a.userId)))
          .slice(0, 6);
  function pickMention(username: string) {
    setText((v) => v.replace(/@([a-z0-9_.]{0,21})$/i, `@${username} `));
    haptic();
    textRef.current?.focus();
  }
  const typingName = typing ? (isGroup ? `@${memberBy.get(typing)?.username ?? '…'}` : name) : null;

  return (
    <div className={cn('flex min-h-[100dvh] flex-col', community && 'lg:pl-[260px] lg:[--dm-left:600px] xl:[--dm-left:640px]')}>
      {/* Desktop: the community's channels stay open on the left (Discord) */}
      {community && conv && (
        <aside className="fixed bottom-8 top-0 z-20 hidden w-[260px] overflow-y-auto border-r border-white/[0.06] bg-[#070A12]/80 px-3 pb-6 pt-4 [left:340px] lg:block xl:[left:380px]">
          <CommunityPanel
            tall
            onClose={() => undefined}
            conv={conv}
            current={channelId}
            onPick={pickChannel}
            lounge={liveCall}
            inLounge={inLiveCall}
            onLounge={() => canCall && void calls.start(id, false)}
            isOwner={isOwner}
            onInvite={() => setInviteOpen(true)}
            onChannels={() => setChannelsOpen(true)}
            onMembers={() => setInfo(true)}
            onLeave={() => void leave()}
            onSquad={() => setSquadOpen(true)}
          />
        </aside>
      )}
      {/* Header */}
      <header className="kamby-frost-bar-phone sticky top-0 z-30 flex items-center gap-2 border-b border-white/[0.05] px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] md:bg-bg/90">
        <button
          type="button"
          aria-label={t('back')}
          onClick={() => (window.history.length > 1 ? router.back() : router.push('/messages'))}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10 md:hidden"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        {conv?.group ? (
          <button type="button" onClick={() => (community ? setHomeOpen(true) : setInfo(true))} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
            {community ? <CommunityAvatar title={conv.group.title} className="h-9 w-9 text-sm" /> : <GroupAvatar members={conv.group.members} meId={conv.meId} className="h-9 w-9" />}
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold text-ink-900">{name}</span>
              <span className="block truncate font-body text-[0.68rem] text-ink-400">
                {channelName && <span className="font-semibold text-accent">#{channelName} · </span>}
                {t('members', { count: conv.group.members.length })}
                {(conv.onlineIds?.length ?? 0) > 0 && <span className="text-up"> · {t('onlineCount', { count: conv.onlineIds.length })}</span>}
              </span>
            </span>
          </button>
        ) : conv?.other?.walletAddress ? (
          <Link href={`/trader/${conv.other.walletAddress}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="relative shrink-0">
              <DmAvatar name={conv.other.username} src={conv.other.avatarUrl} className="h-9 w-9 text-sm" />
              {otherOnline && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-up" aria-label={t('activeNow')} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold text-ink-900">{name}</span>
              {otherOnline && <span className="block font-body text-[0.68rem] text-up">{t('activeNow')}</span>}
            </span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="relative shrink-0">
              <DmAvatar name={conv?.other?.username ?? null} src={conv?.other?.avatarUrl ?? null} className="h-9 w-9 text-sm" />
              {otherOnline && <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg bg-up" aria-label={t('activeNow')} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold text-ink-900">{name}</span>
              {otherOnline && <span className="block font-body text-[0.68rem] text-up">{t('activeNow')}</span>}
            </span>
          </span>
        )}
        {community && (
          <button type="button" aria-label={t('inviteTitle')} onClick={() => setInviteOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6" />
            </svg>
          </button>
        )}
        {canCall && !community && (
          <>
            <button type="button" aria-label={t('callVoice')} onClick={() => void calls.start(id, false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
              </svg>
            </button>
            <button type="button" aria-label={t('callVideo')} onClick={() => void calls.start(id, true)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-600 active:bg-white/10">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m22 8-6 4 6 4V8Z" />
                <rect x="2" y="6" width="14" height="12" rx="2" />
              </svg>
            </button>
          </>
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
            <div className="kamby-glass-solid absolute right-0 top-11 z-40 w-52 overflow-hidden rounded-2xl py-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]" role="menu">
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setMuteOpen(true);
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10"
              >
                <span aria-hidden>{conv?.mute ? '🔔' : '🔕'}</span>
                {conv?.mute ? t('unmute') : t('muteNotifications')}
              </button>
              {isGroup ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false);
                      setInfo(true);
                    }}
                    className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10"
                  >
                    {community ? t('communityInfo') : t('groupInfo')}
                  </button>
                  {isOwner && community && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        setChannelsOpen(true);
                      }}
                      className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10"
                    >
                      {t('channels')}
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenu(false);
                        setAdding(true);
                      }}
                      className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10"
                    >
                      {t('addPeople')}
                    </button>
                  )}
                  <button type="button" onClick={() => void report()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-down active:bg-white/10">
                    {t('report')}
                  </button>
                  <button type="button" onClick={() => void leave()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-600 active:bg-white/10">
                    {t('leave')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => void toggleBlock()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-900 active:bg-white/10">
                    {conv?.blocked ? t('unblock') : t('block')}
                  </button>
                  <button type="button" onClick={() => void report()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-down active:bg-white/10">
                    {t('report')}
                  </button>
                  <button type="button" onClick={() => void remove()} className="block w-full px-4 py-2.5 text-left font-body text-sm text-ink-600 active:bg-white/10">
                    {t('deleteChat')}
                  </button>
                </>
              )}
            </div>
          )}
        </span>
      </header>

      {community && (
        <ChannelBar
          className="lg:hidden"
          channels={community.channels}
          current={channelId}
          onPick={pickChannel}
          lounge={liveCall}
          inLounge={inLiveCall}
          onLounge={() => canCall && void calls.start(id, false)}
          canAdd={isOwner}
          onAdd={() => setChannelsOpen(true)}
          personOf={(u) => memberBy.get(u)}
        />
      )}

      {/* A call is on in this chat — join it */}
      {liveCall && !community && !inLiveCall && liveCall.participants.length > 0 && canCall && (
        <button
          type="button"
          onClick={() => void calls.start(id, false)}
          className="sticky top-[calc(env(safe-area-inset-top)+3.6rem)] z-20 mx-3 mt-2 flex items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 font-display text-sm font-bold text-accent">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
            {t('callOn', { count: liveCall.participants.length })}
          </span>
          <span className="rounded-full bg-accent px-3 py-1 font-display text-xs font-bold text-black">{t('joinCall')}</span>
        </button>
      )}

      {/* Messages */}
      <main key={channelId ?? 'chat'} className={cn('mx-auto w-full max-w-2xl flex-1 px-3 pb-36 pt-3 md:pb-44', community && 'kamby-channel-in')}>
        {nextBefore && (
          <button type="button" onClick={() => void loadEarlier()} className="mx-auto mb-2 block rounded-full bg-white/[0.05] px-4 py-1.5 font-body text-xs font-semibold text-ink-400">
            {t('loadEarlier')}
          </button>
        )}
        {conv && messages.length === 0 && (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            {channelName ? (
              <span className="flex h-20 w-20 items-center justify-center rounded-[30%] border border-accent/25 bg-accent/[0.08] font-display text-4xl font-black text-accent" aria-hidden>
                #
              </span>
            ) : conv.group ? (
              <GroupAvatar members={conv.group.members} meId={conv.meId} className="h-20 w-20" />
            ) : (
              <DmAvatar name={conv.other?.username ?? null} src={conv.other?.avatarUrl ?? null} className="h-20 w-20 text-2xl" />
            )}
            <p className="mt-3 font-display text-lg font-bold text-ink-900">{channelName ? `#${channelName}` : name}</p>
            <p className="mt-1 font-body text-sm text-ink-400">{channelName ? t('channelWelcome', { title: name }) : t('sayHi')}</p>
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const first = newDay || prev?.senderId !== m.senderId || prev?.kind === 'system' || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
          const last = !next || next.senderId !== m.senderId || new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() > 5 * 60_000;
          return (
            <div key={m.id}>
              {newDay && <p className="my-4 text-center font-body text-[0.68rem] font-semibold uppercase tracking-wider text-ink-400">{dayLabel(m.createdAt, t)}</p>}
              {m.id === firstUnreadId && (
                <div className="my-3 flex items-center gap-2" role="separator">
                  <span className="h-px flex-1 bg-gradient-to-r from-transparent to-accent/60" />
                  <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-body text-[0.62rem] font-bold uppercase tracking-wider text-accent">{t('newMessages')}</span>
                  <span className="h-px flex-1 bg-gradient-to-l from-transparent to-accent/60" />
                </div>
              )}
              <DmMessageView
                m={m}
                mine={m.senderId === me}
                me={me}
                first={first}
                last={last}
                sender={isGroup ? (memberBy.get(m.senderId) ?? { userId: m.senderId, username: null, avatarUrl: null, walletAddress: null }) : null}
                onReact={(mid, e) => void react(mid, e)}
                onReply={canWrite ? (msg) => {
                  setReplyTo(msg);
                  textRef.current?.focus();
                } : undefined}
                meName={me ? (memberBy.get(me)?.username ?? null) : null}
              />
            </div>
          );
        })}
        {seen && <p className="mr-2 mt-1 text-right font-body text-[0.68rem] text-ink-400">{t('seen')}</p>}
        {typingName && (
          <div className="mt-2 flex items-center gap-2">
            {isGroup && <span className="font-body text-[0.7rem] text-ink-400">{typingName}</span>}
            <span className="kamby-glass flex items-center gap-1 rounded-3xl px-4 py-3" aria-label={t('typing', { name: typingName })}>
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </span>
          </div>
        )}
        <div ref={bottomRef} className="scroll-mb-36 md:scroll-mb-44" />
      </main>

      {/* Bottom: request choice, blocked note, or the composer */}
      <div className="fixed bottom-0 right-0 z-30 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 [left:var(--dm-left,0px)] md:bottom-8 md:px-6">
        <div className="relative mx-auto max-w-2xl">
        {(scrolledUp || newBelow > 0) && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="kamby-pop kamby-glass-solid absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-2 font-display text-xs font-bold text-ink-900 shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden>
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            {newBelow > 0 ? t('newBelow', { count: newBelow }) : t('latest')}
          </button>
        )}
        {conv?.state === 'request' && !conv.blocked ? (
          <div className="kamby-glass-solid rounded-3xl p-4 text-center">
            <p className="font-display text-sm font-bold text-ink-900">{isGroup ? t('groupInviteTitle', { title: name }) : t('requestTitle', { name })}</p>
            <p className="mt-1 font-body text-xs text-ink-400">{isGroup ? t('groupInviteBody') : t('requestBody')}</p>
            <div className={cn('mt-3 grid gap-2', isGroup ? 'grid-cols-2' : 'grid-cols-3')}>
              {!isGroup && (
                <button type="button" onClick={() => void toggleBlock()} className="rounded-2xl bg-down/10 py-2.5 font-display text-sm font-bold text-down">
                  {t('block')}
                </button>
              )}
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
            {mentionPeople.length > 0 && (
              <ul className="kamby-pop kamby-glass-solid mb-1.5 overflow-hidden rounded-2xl py-1" role="listbox" aria-label={t('mentionSomeone')}>
                {mentionPeople.map((p) => (
                  <li key={p.userId}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickMention(p.username!)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.1]"
                    >
                      <span className="relative shrink-0">
                        <DmAvatar name={p.username} src={p.avatarUrl} className="h-7 w-7 text-[0.6rem]" />
                        {conv?.onlineIds?.includes(p.userId) && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0B0F18] bg-up" aria-hidden />}
                      </span>
                      <span className="font-display text-sm font-bold" style={{ color: nameColor(p.userId) }}>
                        @{p.username}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {replyTo && (
              <div className="kamby-pop kamby-glass-solid mb-1.5 flex items-center gap-2.5 rounded-2xl py-2 pl-3 pr-1.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent" aria-hidden>
                  <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[0.7rem] font-bold text-accent">
                    {t('replyingTo', { name: replyTo.senderId === me ? t('you') : `@${memberBy.get(replyTo.senderId)?.username ?? conv?.other?.username ?? '…'}` })}
                  </span>
                  <span className="block truncate font-body text-xs text-ink-400">{replyTo.kind === 'text' ? replyTo.body : replyTo.coin?.symbol ? `$${replyTo.coin.symbol}` : replyTo.pnl?.symbol ? `PnL · $${replyTo.pnl.symbol}` : '…'}</span>
                </span>
                <button type="button" aria-label={t('cancelReply')} onClick={() => setReplyTo(null)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 active:bg-white/10">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            <form onSubmit={(e) => void submit(e)} className="kamby-glass-solid kamby-glass-dense relative flex items-end gap-1.5 rounded-[1.6rem] p-1.5 shadow-[0_10px_36px_rgba(0,0,0,0.6)]">
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
                ref={textRef}
                value={text}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  if (mentionPeople.length > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
                    e.preventDefault();
                    pickMention(mentionPeople[0]!.username!);
                    return;
                  }
                  if (e.key === 'Escape' && replyTo) setReplyTo(null);
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                disabled={!canWrite}
                placeholder={channelName ? t('channelPlaceholderSay', { channel: channelName }) : t('placeholder')}
                className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 font-body text-[0.95rem] leading-snug text-ink-900 placeholder:text-ink-400 focus:outline-none [field-sizing:content]"
              />
              {/* Empty field + voice switched on → hold-to-record mic (WhatsApp); otherwise Send. */}
              {voiceOn && !text.trim() ? (
                <VoiceRecorderButton
                  disabled={!canWrite || sending}
                  onSend={(blob, ms, bars) => {
                    setFirstUnreadId(null);
                    void run(() => sendDmVoice(id, blob, ms, bars, channelId ?? undefined));
                  }}
                />
              ) : (
                <button
                  type="submit"
                  aria-label={t('send')}
                  disabled={!canWrite || sending || !text.trim()}
                  className="kamby-pop flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-black transition-transform active:scale-90 disabled:opacity-30"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
            </form>
          </>
        )}
        </div>
      </div>

      {/* Group info */}
      {conv?.group && (
        <MobileDrawer open={info} onClose={() => setInfo(false)} title={conv.group.title} desktop>
          <div className="flex items-center justify-between">
            <p className="font-body text-xs font-semibold uppercase tracking-wider text-ink-400">{t('members', { count: conv.group.members.length })}</p>
            {isOwner && (
              <span className="flex gap-3">
                <button type="button" onClick={() => void rename()} className="font-display text-xs font-bold text-accent">
                  {t('rename')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInfo(false);
                    setAdding(true);
                  }}
                  className="font-display text-xs font-bold text-accent"
                >
                  {t('addPeople')}
                </button>
              </span>
            )}
          </div>
          <ul className="mt-2 max-h-[50vh] overflow-y-auto">
            {conv.group.members.map((p) => (
              <li key={p.userId} className="flex items-center gap-3 py-2">
                <DmAvatar name={p.username} src={p.avatarUrl} className="h-10 w-10 text-sm" />
                <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">
                  {p.username ? `@${p.username}` : t('someone')}
                  {p.userId === me && <span className="ml-1.5 font-body text-xs font-normal text-ink-400">· {t('you')}</span>}
                </span>
                {p.userId === conv.group!.ownerId && <span className="rounded-full bg-accent/10 px-2 py-0.5 font-body text-[0.6rem] font-bold text-accent">{t('admin')}</span>}
                {isOwner && p.userId !== me && (
                  <button type="button" onClick={() => void kick(p.userId)} className="rounded-full bg-white/[0.06] px-2.5 py-1 font-body text-[0.65rem] font-semibold text-ink-600">
                    {t('remove')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void leave()} className="mt-3 w-full rounded-2xl bg-down/10 py-3 font-display text-sm font-bold text-down">
            {t('leave')}
          </button>
        </MobileDrawer>
      )}
      {conv?.group && isOwner && (
        <AddPeopleDrawer
          open={adding}
          onClose={() => setAdding(false)}
          id={id}
          room={Math.min(31, (community ? DM_LIMITS.communityMaxMembers : DM_LIMITS.groupMaxMembers) - conv.group.members.length)}
          onDone={refreshConv}
        />
      )}
      {community && conv && (
        <CommunityHome
          open={homeOpen}
          onClose={() => setHomeOpen(false)}
          conv={conv}
          current={channelId}
          onPick={pickChannel}
          lounge={liveCall}
          inLounge={inLiveCall}
          onLounge={() => canCall && void calls.start(id, false)}
          isOwner={isOwner}
          onInvite={() => {
            setHomeOpen(false);
            setInviteOpen(true);
          }}
          onChannels={() => {
            setHomeOpen(false);
            setChannelsOpen(true);
          }}
          onMembers={() => {
            setHomeOpen(false);
            setInfo(true);
          }}
          onLeave={() => void leave()}
          onSquad={() => {
            setHomeOpen(false);
            setSquadOpen(true);
          }}
        />
      )}
      {community && (
        <>
          <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} id={id} code={community.inviteCode} isOwner={isOwner} onDone={refreshConv} />
          {isOwner && <ChannelsDrawer open={channelsOpen} onClose={() => setChannelsOpen(false)} id={id} channels={community.channels} onDone={refreshConv} />}
        </>
      )}

      {community && conv && isOwner && <SquadSettingsDrawer open={squadOpen} onClose={() => setSquadOpen(false)} conv={conv} onDone={setConv} />}
      {conv && attach === 'duel' && <ChallengeSheet open onClose={() => setAttach(null)} conv={conv} onSent={() => undefined} />}
      {conv && <MuteDrawer open={muteOpen} onClose={() => setMuteOpen(false)} conv={conv} onDone={setConv} />}

      {/* + menu */}
      <MobileDrawer open={attach === 'menu'} onClose={() => setAttach(null)} title={t('attachTitle')} desktop>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {(
            [
              ['trade', '⚡', t('attachTrade')],
              ['duel', '⚔️', t('attachDuel')],
              ['coin', '🪙', t('attachCoin')],
              ['pnl', '📈', t('attachPnl')],
              ['usdc', '💸', t('attachUsdc')],
            ] as const
          )
            .filter(([key]) => !isGroup || key !== 'usdc')
            .map(([key, icon, label]) => (
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
          if (slug) void run(() => sendDmCoin(id, slug, m.tokenAddress, channelId ?? undefined));
        }}
      />
      <PositionPicker
        open={attach === 'pnl' || attach === 'trade'}
        title={attach === 'trade' ? t('attachTradeTitle') : undefined}
        onClose={() => setAttach(null)}
        onPick={(p) => {
          const kind = attach;
          setAttach(null);
          const slug = chainSlug(p.chainIdentifier ?? (p.chain === 'solana' ? 'solana' : ''));
          if (!slug) return;
          if (kind === 'trade') void run(() => sendDmTrade(id, slug, p.tokenAddress, channelId ?? undefined));
          else void run(() => sendDmPnl(id, slug, p.tokenAddress, channelId ?? undefined));
        }}
      />
      {conv?.other?.username && (
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

