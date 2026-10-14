'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TOKEN_CHAT_LIMITS, type TokenChatEvent, type TokenChatItem } from '@kamby/domain';
import { openResilientEventSource } from './resilient-event-source';
import { API_BASE, authedFetch } from './session-client';
import type { RealtimeStatus } from './social-client';

async function send<T>(path: string, body: unknown): Promise<T> {
  const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `Could not send (${res.status})`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json.message) message = Array.isArray(json.message) ? json.message[0]! : json.message;
    } catch {
      // keep the fallback
    }
    const error = new Error(message) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const postTokenMessage = (token: string, body: string) => send<TokenChatItem>('/pulse/token/messages', { token, body });
export const postTokenPnl = (token: string) => send<TokenChatItem>('/pulse/token/pnl', { token });
export const sendReaction = (token: string, emoji: string) => send<void>('/pulse/token/react', { token, emoji });
export const reportMessage = (id: string) => send<{ hidden: boolean }>(`/pulse/messages/${id}/report`, {});

/** Keeps the newest `max`, no duplicates, oldest first. */
function merge(prev: TokenChatItem[], next: TokenChatItem[]): TokenChatItem[] {
  const seen = new Set(prev.map((i) => `${i.kind}:${i.id}`));
  const added = next.filter((i) => !seen.has(`${i.kind}:${i.id}`));
  if (added.length === 0) return prev;
  const all = [...prev, ...added];
  return all.length > TOKEN_CHAT_LIMITS.maxOnScreen ? all.slice(-TOKEN_CHAT_LIMITS.maxOnScreen) : all;
}

/**
 * One coin's live chat: the last messages and Kamby trades, then the live stream (new items,
 * take-downs, and reactions — handed to `onReaction` as they fly in). At most
 * TOKEN_CHAT_LIMITS.maxOnScreen items are kept, so a busy room never bloats the page.
 */
export function useTokenChat(tokenKey: string | null, onReaction: (emoji: string) => void) {
  const [items, setItems] = useState<TokenChatItem[] | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const reactionRef = useRef(onReaction);
  reactionRef.current = onReaction;

  useEffect(() => {
    if (!tokenKey) return;
    let cancelled = false;
    setItems(null);
    fetch(`${API_BASE}/v1/pulse/token/messages?token=${encodeURIComponent(tokenKey)}`)
      .then((res) => (res.ok ? (res.json() as Promise<TokenChatItem[]>) : []))
      .then((list) => !cancelled && setItems((prev) => merge([], [...list, ...(prev ?? [])])))
      .catch(() => !cancelled && setItems((prev) => prev ?? []));
    const parse = (data: string): TokenChatEvent | null => {
      try {
        return JSON.parse(data) as TokenChatEvent;
      } catch {
        return null;
      }
    };
    const close = openResilientEventSource(
      `${API_BASE}/v1/pulse/token/stream?token=${encodeURIComponent(tokenKey)}`,
      {
        item: (data) => {
          const event = parse(data);
          if (event?.type === 'item') setItems((prev) => merge(prev ?? [], [event.item]));
        },
        hide: (data) => {
          const event = parse(data);
          if (event?.type === 'hide') setItems((prev) => prev?.filter((i) => i.id !== event.id) ?? prev);
        },
        reaction: (data) => {
          const event = parse(data);
          if (event?.type === 'reaction') reactionRef.current(event.emoji);
        },
      },
      setStatus,
    );
    return () => {
      cancelled = true;
      close();
    };
  }, [tokenKey]);

  /** Shows a just-sent item right away (the stream's copy of it is then a duplicate, dropped). */
  const add = useCallback((item: TokenChatItem) => setItems((prev) => merge(prev ?? [], [item])), []);
  const remove = useCallback((id: string) => setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev), []);

  return { items, status, add, remove };
}
