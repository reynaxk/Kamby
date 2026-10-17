'use client';

import { useEffect, useState } from 'react';
import type { DmConversation, DmMessage, DmUnread } from '@kamby/domain';
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
export const fetchDmMessages = (id: string, before?: string) =>
  json<{ items: DmMessage[]; nextBefore: string | null }>(`/dm/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export const openConversation = (username: string) => json<DmConversation>('/dm/open', post({ username }), 'open the chat');
export const sendDmText = (id: string, body: string) => json<DmMessage>(`/dm/conversations/${id}/messages`, post({ body }), 'send the message');
export const sendDmCoin = (id: string, chain: string, tokenAddress: string) => json<DmMessage>(`/dm/conversations/${id}/coin`, post({ chain, tokenAddress }), 'share the coin');
export const sendDmPnl = (id: string, chain: string, tokenAddress: string) => json<DmMessage>(`/dm/conversations/${id}/pnl`, post({ chain, tokenAddress }), 'share your PnL');
export const sendDmUsdc = (id: string, chain: string, txRef: string) => json<DmMessage>(`/dm/conversations/${id}/usdc`, post({ chain, txRef }), 'post the transfer');
export const reactToDm = (messageId: string, emoji: string) => json<Record<string, string[]>>(`/dm/messages/${messageId}/react`, post({ emoji }), 'react');
export const acceptConversation = (id: string) => json<DmConversation>(`/dm/conversations/${id}/accept`, post(), 'accept the request');
export const blockConversation = (id: string, blocked: boolean) => json<DmConversation>(`/dm/conversations/${id}/block`, post({ blocked }), 'block');

async function fire(path: string, body?: unknown): Promise<void> {
  const res = await authedFetch(path, post(body));
  await expectOk(res, 'update the chat');
}
export const markDmRead = (id: string) => fire(`/dm/conversations/${id}/read`);
export const sendDmTyping = (id: string) => fire(`/dm/conversations/${id}/typing`).catch(() => undefined);
export const hideConversation = (id: string) => fire(`/dm/conversations/${id}/hide`);
export const reportConversation = (id: string, reason?: string) => fire(`/dm/conversations/${id}/report`, { reason });

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
