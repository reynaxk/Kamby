'use client';

import { useEffect, useState } from 'react';
import type { DmConversation, DmInvitePreview, DmMessage, DmUnread } from '@kamby/domain';
import { authedFetch, expectOk, hasStoredSession } from './session-client';
import { subscribePrivateStream } from './private-stream';

/** Browser client for private messages (2026-10-17) — see apps/api/src/dm. */

async function json<T>(path: string, init?: RequestInit, what = 'load messages'): Promise<T> {
  const res = await authedFetch(path, init);
  await expectOk(res, what);
  return (await res.json()) as T;
}

function post(body?: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const fetchConversations = (box: 'chats' | 'requests') => json<DmConversation[]>(`/dm/conversations?box=${box}`);
export const fetchDmUnread = () => json<DmUnread>('/dm/unread');
export const fetchConversation = (id: string) => json<DmConversation>(`/dm/conversations/${id}`);
export const fetchDmMessages = (id: string, before?: string, channelId?: string) => {
  const q = new URLSearchParams();
  if (before) q.set('before', before);
  if (channelId) q.set('channelId', channelId);
  const qs = q.toString();
  return json<{ items: DmMessage[]; nextBefore: string | null }>(`/dm/conversations/${id}/messages${qs ? `?${qs}` : ''}`);
};
export const openConversation = (username: string) => json<DmConversation>('/dm/open', post({ username }), 'open the chat');
export const sendDmText = (id: string, body: string, channelId?: string, replyToId?: string) =>
  json<DmMessage>(`/dm/conversations/${id}/messages`, post({ body, channelId, replyToId }), 'send the message');
export const sendDmCoin = (id: string, chain: string, tokenAddress: string, channelId?: string) =>
  json<DmMessage>(`/dm/conversations/${id}/coin`, post({ chain, tokenAddress, channelId }), 'share the coin');
export const sendDmPnl = (id: string, chain: string, tokenAddress: string, channelId?: string) =>
  json<DmMessage>(`/dm/conversations/${id}/pnl`, post({ chain, tokenAddress, channelId }), 'share your PnL');
export const sendDmTrade = (id: string, chain: string, tokenAddress: string, channelId?: string) =>
  json<DmMessage>(`/dm/conversations/${id}/trade`, post({ chain, tokenAddress, channelId }), 'share the trade');
export const sendDmUsdc = (id: string, chain: string, txRef: string) => json<DmMessage>(`/dm/conversations/${id}/usdc`, post({ chain, txRef }), 'post the transfer');
export const reactToDm = (messageId: string, emoji: string) => json<Record<string, string[]>>(`/dm/messages/${messageId}/react`, post({ emoji }), 'react');
export const acceptConversation = (id: string) => json<DmConversation>(`/dm/conversations/${id}/accept`, post(), 'accept the request');
export const blockConversation = (id: string, blocked: boolean) => json<DmConversation>(`/dm/conversations/${id}/block`, post({ blocked }), 'block');
// Groups (2026-10-17).
export const createGroup = (title: string, usernames: string[]) => json<DmConversation>('/dm/groups', post({ title, usernames }), 'create the group');
export const addGroupMembers = (id: string, usernames: string[]) => json<DmConversation>(`/dm/conversations/${id}/members`, post({ usernames }), 'add people');
export const removeGroupMember = (id: string, userId: string) => json<DmConversation>(`/dm/conversations/${id}/members/${userId}/remove`, post(), 'remove them');
export const createCommunity = (title: string) => json<DmConversation>('/dm/communities', post({ title }), 'create the community');
export const createChannel = (id: string, name: string, kind: 'text' | 'voice') => json<DmConversation>(`/dm/conversations/${id}/channels`, post({ name, kind }), 'add the channel');
export const deleteChannel = (id: string, channelId: string) => json<DmConversation>(`/dm/conversations/${id}/channels/${channelId}/delete`, post(), 'delete the channel');
export const resetInvite = (id: string) => json<DmConversation>(`/dm/conversations/${id}/invite/reset`, post(), 'reset the link');
export const fetchInvite = (code: string) => json<DmInvitePreview>(`/dm/invite/${encodeURIComponent(code)}`, undefined, 'open the invite');
export const joinInvite = (code: string) => json<DmConversation>(`/dm/invite/${encodeURIComponent(code)}/join`, post(), 'join');
/** The link people share: kambesh.com/c/<code>. */
export const inviteUrl = (code: string) => `${typeof window === 'undefined' ? 'https://kambesh.com' : window.location.origin}/c/${code}`;
export const renameGroup = (id: string, title: string) => json<DmConversation>(`/dm/conversations/${id}/rename`, post({ title }), 'rename the group');

async function fire(path: string, body?: unknown): Promise<void> {
  const res = await authedFetch(path, post(body));
  await expectOk(res, 'update the chat');
}
export const markDmRead = (id: string) => fire(`/dm/conversations/${id}/read`);
export const sendDmTyping = (id: string) => fire(`/dm/conversations/${id}/typing`).catch(() => undefined);
export const hideConversation = (id: string) => fire(`/dm/conversations/${id}/hide`);
export const reportConversation = (id: string, reason?: string) => fire(`/dm/conversations/${id}/report`, { reason });
export const leaveGroup = (id: string) => fire(`/dm/conversations/${id}/leave`);
/** Mute a chat's notifications: minutes, null = until unmuted, 0 = unmute. */
export const muteConversation = (id: string, minutes: number | null) =>
  json<DmConversation>(`/dm/conversations/${id}/mute`, post(minutes === null ? { forever: true } : { minutes }), 'mute the chat');
/** "Kamby is open (on this chat)" — the green dot, and no push for the chat on screen. Never throws. */
export function sendPresence(viewing?: string): Promise<void> {
  return fire('/dm/presence', viewing ? { viewing } : {}).catch(() => undefined);
}

/** Unread private messages + waiting requests, kept fresh by the private stream. */
export function useDmUnread(): DmUnread | null {
  const [unread, setUnread] = useState<DmUnread | null>(null);
  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetchDmUnread()
        .then((u) => !cancelled && setUnread(u))
        .catch(() => undefined);
    };
    // Events arrive in bursts (a message + a read) — one refetch per burst.
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    load();
    const unsubscribe = subscribePrivateStream({ onDm: (e) => e.type !== 'typing' && e.type !== 'reaction' && soon() });
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return unread;
}
