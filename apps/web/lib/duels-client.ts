'use client';

import { useEffect, useState } from 'react';
import { DUEL_LIMITS, type DuelLeader, type DuelState } from '@kamby/domain';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/** Browser client for ⚔️ duels (2026-10-17) — see apps/api/src/duels. */

async function post<T>(path: string, body?: unknown, what = 'update the duel'): Promise<T> {
  const res = await authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  await expectOk(res, what);
  return (await res.json()) as T;
}

export async function fetchDuel(id: string): Promise<DuelState> {
  const res = hasStoredSession() ? await authedFetch(`/duels/${id}`) : await fetch(`${API_BASE}/v1/duels/${id}`);
  await expectOk(res, 'load the duel');
  return (await res.json()) as DuelState;
}
export const challengeDuel = (opponentUsername: string, minutes: number, conversationId?: string) =>
  post<DuelState>('/duels', { opponentUsername, minutes, conversationId }, 'send the challenge');
/** The lobby (2026-10-18): open duels anyone can join, and the month's top duelists. */
export async function fetchOpenDuels(): Promise<DuelState[]> {
  const res = hasStoredSession() ? await authedFetch('/duels/open') : await fetch(`${API_BASE}/v1/duels/open`);
  await expectOk(res, 'load open duels');
  return (await res.json()) as DuelState[];
}
export async function fetchDuelLeaders(): Promise<DuelLeader[]> {
  const res = await fetch(`${API_BASE}/v1/duels/leaders`);
  await expectOk(res, 'load the top duelists');
  return (await res.json()) as DuelLeader[];
}
export const openDuel = (minutes: number) => post<DuelState>('/duels/open', { minutes }, 'start the duel');
export const joinDuel = (id: string) => post<DuelState>(`/duels/${id}/join`, undefined, 'join the duel');
export const acceptDuel = (id: string) => post<DuelState>(`/duels/${id}/accept`, undefined, 'accept the duel');
export const declineDuel = (id: string) => post<DuelState>(`/duels/${id}/decline`, undefined, 'decline the duel');
export const cancelDuel = (id: string) => post<DuelState>(`/duels/${id}/cancel`, undefined, 'cancel the duel');
export const cheerDuel = (id: string, side: 'challenger' | 'opponent', emoji: string) => post<Record<string, number>>(`/duels/${id}/cheer`, { side, emoji }, 'cheer');

/** A duel's state, refreshed every few seconds while it's open or live (paused when hidden or
 *  off screen); `set` lets an action drop its fresh state straight in. */
export function useDuel(id: string, active = true): [DuelState | null, (d: DuelState) => void, string | null] {
  const [duel, setDuel] = useState<DuelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = !duel || duel.status === 'open' || duel.status === 'pending' || duel.status === 'live';
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const d = await fetchDuel(id);
          if (!cancelled) {
            setDuel(d);
            setError(null);
          }
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : 'error');
        }
      }
      if (!cancelled && running) timer = setTimeout(() => void tick(), DUEL_LIMITS.pollMs);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, active, running]);
  return [duel, setDuel, error];
}

/** "4:07" until a moment (or 0:00). Re-renders every second. */
export function useCountdown(untilIso: string | null): { text: string; leftMs: number } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!untilIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [untilIso]);
  const leftMs = untilIso ? Math.max(0, Date.parse(untilIso) - now) : 0;
  const s = Math.floor(leftMs / 1000);
  const text = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return { text, leftMs };
}
