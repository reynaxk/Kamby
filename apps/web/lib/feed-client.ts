'use client';

import type { FeedPage, FeedPost, FeedReply, FeedTab } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/** On once the Feed's tables are in the production database (migration 20261030160000_feed_posts).
 *  Off: no Feed links, no profile Posts section, and /feed says it's coming. */
export const FEED_ENABLED = false;

/** Signed in: the server knows which posts you liked; signed out: plain public read. */
async function get<T>(path: string, what: string): Promise<T> {
  const res = hasStoredSession() ? await authedFetch(path) : await fetch(`${API_BASE}/v1${path}`);
  await expectOk(res, what);
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown, what: string): Promise<T> {
  const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  await expectOk(res, what);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export function fetchFeed(tab: FeedTab, before?: string | null, address?: string): Promise<FeedPage> {
  const q = new URLSearchParams({ tab });
  if (before) q.set('before', before);
  if (address) q.set('address', address);
  return get<FeedPage>(`/feed?${q.toString()}`, 'load the feed');
}

export const createFeedPost = (body: string, attach?: { kind: 'trade' | 'pnl'; chain: string; tokenAddress: string }) =>
  post<FeedPost>('/feed/posts', { body, attach }, 'post');
export const likeFeedPost = (id: string, on: boolean) => post<{ likeCount: number; likedByMe: boolean }>(`/feed/posts/${id}/like`, { on }, 'like');
export const fetchFeedReplies = (id: string) => get<FeedReply[]>(`/feed/posts/${id}/replies`, 'load the replies');
export const replyToFeedPost = (id: string, body: string) => post<FeedReply>(`/feed/posts/${id}/replies`, { body }, 'reply');
export const reportFeedPost = (id: string) => post<{ hidden: boolean }>(`/feed/posts/${id}/report`, {}, 'report');
export const deleteFeedPost = (id: string) => post<void>(`/feed/posts/${id}/delete`, {}, 'delete');
