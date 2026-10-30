'use client';

import type { FeedPage, FeedPost, FeedReply, FeedTab } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/** On once the Feed's tables are in the production database (migration 20261030160000_feed_posts).
 *  Off: no Feed links, no profile Posts section, and /feed says it's coming. */
export const FEED_ENABLED = true;

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

export const createFeedPost = (body: string, attach?: { kind: 'trade' | 'pnl' | 'photo' | 'video'; chain?: string; tokenAddress?: string; photoId?: string; videoId?: string }) =>
  post<FeedPost>('/feed/posts', { body, attach }, 'post');
export const likeFeedPost = (id: string, on: boolean) => post<{ likeCount: number; likedByMe: boolean }>(`/feed/posts/${id}/like`, { on }, 'like');
export const fetchFeedReplies = (id: string) => get<FeedReply[]>(`/feed/posts/${id}/replies`, 'load the replies');
export const replyToFeedPost = (id: string, body: string) => post<FeedReply>(`/feed/posts/${id}/replies`, { body }, 'reply');
export const reportFeedPost = (id: string) => post<{ hidden: boolean }>(`/feed/posts/${id}/report`, {}, 'report');
export const deleteFeedPost = (id: string) => post<void>(`/feed/posts/${id}/delete`, {}, 'delete');

export const fetchFeedCapabilities = () => get<{ photos: boolean; videos?: boolean }>('/feed/capabilities', 'check photos');

/** Shrinks a photo in the browser first (max 1600px, JPEG) — faster uploads, under the 5MB cap,
 *  and iPhone HEIC comes out as JPEG. Then the server checks it with moderation before storing. */
export async function uploadFeedPhoto(file: File): Promise<{ photoId: string; url: string }> {
  const blob = await shrink(file).catch(() => file);
  const form = new FormData();
  form.set('file', blob, 'photo.jpg');
  const res = await authedFetch('/feed/photos', { method: 'POST', body: form });
  await expectOk(res, 'upload the photo');
  return (await res.json()) as { photoId: string; url: string };
}

async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('shrink'))), 'image/jpeg', 0.86));
}

/** How long a clip is, read in the browser before uploading (so a too-long one is refused fast). */
export function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(v.duration);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(Number.NaN);
    };
    v.src = url;
  });
}

/** Up to 15 s / 20 MB; the server checks every 3rd second with moderation before storing it. */
export async function uploadFeedVideo(file: File): Promise<{ videoId: string; url: string }> {
  const form = new FormData();
  form.set('file', file, file.name || 'clip.mp4');
  const res = await authedFetch('/feed/videos', { method: 'POST', body: form });
  await expectOk(res, 'upload the video');
  return (await res.json()) as { videoId: string; url: string };
}
