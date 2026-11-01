'use client';

import { useEffect, useState } from 'react';
import type { AchievementsDto, ClientAchievementEvent } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/** Achievements & titles (2026-11-01) — see AchievementsService in the API. */

export async function fetchMyAchievements(): Promise<AchievementsDto> {
  const res = await authedFetch('/achievements/me');
  await expectOk(res, 'load your titles');
  return res.json();
}

export async function fetchUserAchievements(username: string): Promise<AchievementsDto | null> {
  const res = await fetch(`${API_BASE}/v1/achievements/u/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`achievements ${res.status}`);
  return res.json();
}

export async function saveTitles(input: { equippedTitleId?: string | null; showcaseTitleIds?: string[] }): Promise<AchievementsDto> {
  const res = await authedFetch('/achievements/title', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await expectOk(res, 'save your title');
  const dto = (await res.json()) as AchievementsDto;
  return dto;
}

/** Report an app-side counter (screen time, chart time, clicks, easter eggs). Fire and forget. */
export function sendAchievementEvent(kind: ClientAchievementEvent, token?: string): void {
  if (!hasStoredSession()) return;
  void authedFetch('/achievements/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(token ? { kind, token } : { kind }),
  }).catch(() => undefined);
}

// --- Worn titles next to names: one batched lookup for every name on screen. ---

const TTL_MS = 5 * 60_000;
const known = new Map<string, { id: string | null; at: number }>();
const waiting = new Map<string, Set<(id: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  const names = [...waiting.keys()];
  if (!names.length) return;
  const batch = names.slice(0, 60);
  const callbacks = batch.map((n) => [n, waiting.get(n)!] as const);
  for (const n of batch) waiting.delete(n);
  if (waiting.size) timer = setTimeout(flush, 50);
  fetch(`${API_BASE}/v1/achievements/titles?u=${batch.map(encodeURIComponent).join(',')}`)
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, string | null>>) : ({} as Record<string, string | null>)))
    .catch(() => ({}) as Record<string, string | null>)
    .then((map: Record<string, string | null>) => {
      for (const [name, cbs] of callbacks) {
        const id = map[name] ?? null;
        known.set(name, { id, at: Date.now() });
        for (const cb of cbs) cb(id);
      }
    });
}

/** Forget a cached title (after you change your own). */
export function forgetTitle(username: string): void {
  known.delete(username.toLowerCase());
}

/** The title this user wears, or null. */
export function useWornTitle(username: string | null | undefined): string | null {
  const name = username?.toLowerCase() ?? null;
  const cached = name ? known.get(name) : undefined;
  const [id, setId] = useState<string | null>(cached?.id ?? null);
  useEffect(() => {
    if (!name) return;
    const hit = known.get(name);
    if (hit && Date.now() - hit.at < TTL_MS) {
      setId(hit.id);
      return;
    }
    let live = true;
    const cb = (v: string | null) => live && setId(v);
    if (!waiting.has(name)) waiting.set(name, new Set());
    waiting.get(name)!.add(cb);
    if (!timer) timer = setTimeout(flush, 40);
    return () => {
      live = false;
      waiting.get(name)?.delete(cb);
    };
  }, [name]);
  return name ? id : null;
}
