'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DM_PRESENCE, type DmConversation, type DmMessage } from '@kamby/domain';
import { fetchConversation, sendPresence } from '@/lib/dm-client';
import { subscribePrivateStream } from '@/lib/private-stream';
import { hasStoredSession } from '@/lib/session-client';
import { CommunityAvatar } from './CommunityBits';
import { DmAvatar } from './DmAvatar';
import { haptic } from './DmMessageView';

const OPEN_CHAT = /^\/messages\/([0-9a-f-]{36})$/i;

interface Banner {
  key: string;
  conversationId: string;
  title: string;
  avatar: { name: string | null; src: string | null; community: boolean };
  line: string;
}

/**
 * Chats everywhere in the app (2026-10-17):
 * - tells the server Kamby is open (the green "online" dot) and which chat is on screen, so a
 *   phone isn't buzzed for the chat you're already reading;
 * - a new line from someone else, while you're anywhere but that chat, slides down from the top
 *   as a glass banner (Instagram-style) — tap it to open the chat.
 */
export function ChatPulse() {
  const t = useTranslations('dm');
  const pathname = usePathname();
  const router = useRouter();
  const [banner, setBanner] = useState<Banner | null>(null);
  const viewingRef = useRef<string | null>(null);
  const convCache = useRef(new Map<string, DmConversation>());
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewing = pathname ? (OPEN_CHAT.exec(pathname)?.[1] ?? null) : null;
  viewingRef.current = viewing;

  // Presence: now, every 30 s while the tab is visible, and right away when it comes back.
  useEffect(() => {
    if (!hasStoredSession()) return;
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      void sendPresence(viewingRef.current ?? undefined);
    };
    beat();
    const timer = setInterval(beat, DM_PRESENCE.heartbeatMs);
    const onVisible = () => (document.visibilityState === 'visible' ? beat() : void sendPresence(undefined));
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [viewing]);

  // In-app banner for new lines.
  useEffect(() => {
    if (!hasStoredSession()) return;
    const show = async (m: DmMessage) => {
      if (m.kind === 'system' || viewingRef.current === m.conversationId) return;
      if (pathname === '/messages' && window.matchMedia('(max-width: 767px)').matches) return; // the list is on screen
      let conv = convCache.current.get(m.conversationId);
      if (!conv) {
        conv = await fetchConversation(m.conversationId).catch(() => undefined);
        if (!conv) return;
        convCache.current.set(m.conversationId, conv);
      }
      if (m.senderId === conv.meId || conv.state !== 'active') return;
      if (conv.mute && !(m.kind === 'text' && /@/.test(m.body))) return; // muted (an @mention still shows)
      const sender = conv.group ? conv.group.members.find((p) => p.userId === m.senderId) : conv.other;
      const who = sender?.username ? `@${sender.username}` : t('someone');
      const what = m.kind === 'text' ? m.body : m.kind === 'coin' ? `$${m.coin?.symbol ?? ''}` : m.kind === 'pnl' ? `PnL · $${m.pnl?.symbol ?? ''}` : m.kind === 'usdc' ? `$${m.usdc?.amountUsd.toFixed(2)} USDC` : '';
      haptic(10);
      setBanner({
        key: m.id,
        conversationId: m.conversationId,
        title: conv.group ? conv.group.title : who,
        avatar: conv.group?.community
          ? { name: conv.group.title, src: null, community: true }
          : { name: sender?.username ?? null, src: sender?.avatarUrl ?? null, community: false },
        line: conv.group ? `${who}: ${what}` : what,
      });
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setBanner(null), 4500);
    };
    const unsubscribe = subscribePrivateStream({
      onDm: (e) => {
        if (e.type === 'message') void show(e.message);
        else if (e.type === 'state') convCache.current.delete(e.conversationId);
      },
    });
    return () => {
      unsubscribe();
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [pathname, t]);

  if (!banner) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <button
        key={banner.key}
        type="button"
        onClick={() => {
          setBanner(null);
          router.push(`/messages/${banner.conversationId}`);
        }}
        className="kamby-toast-in kamby-glass-solid kamby-glass-dense pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[1.4rem] px-3 py-2.5 text-left shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
      >
        {banner.avatar.community ? (
          <CommunityAvatar title={banner.avatar.name ?? '#'} className="h-10 w-10 text-xs" />
        ) : (
          <DmAvatar name={banner.avatar.name} src={banner.avatar.src} className="h-10 w-10 text-sm" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm font-bold text-ink-900">{banner.title}</span>
          <span className="block truncate font-body text-[0.8rem] text-ink-600">{banner.line}</span>
        </span>
        <span className="shrink-0 rounded-full bg-accent px-2.5 py-1 font-display text-[0.65rem] font-bold text-black">{t('openChat')}</span>
      </button>
    </div>
  );
}
