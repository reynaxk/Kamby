'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LiveRoom } from '@kamby/domain';
import { fetchLiveRooms } from '@/lib/live-engine';

/**
 * Scroll through live streams (2026-10-30, owner: "like other streaming platforms"): swipe up on
 * the stage for the next stream, down for the previous; ↑ / ↓ keys and buttons on a computer.
 * Order = most watched first, the same as the Live page. Off for the host (they'd leave their own
 * stream by accident).
 */
export function useLiveSwipe(currentId: string, enabled: boolean) {
  const router = useRouter();
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const start = useRef<{ x: number; y: number; t: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchLiveRooms()
        .then((r) => !cancelled && setRooms([...r].sort((a, b) => b.viewers - a.viewers)))
        .catch(() => undefined);
    void load();
    const timer = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const index = rooms.findIndex((r) => r.id === currentId);
  const next = enabled && index >= 0 ? (rooms[index + 1] ?? null) : null;
  const prev = enabled && index > 0 ? (rooms[index - 1] ?? null) : null;
  const go = (room: LiveRoom | null) => room && router.replace(`/live/${room.id}`);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowDown' && next) go(next);
      if (e.key === 'ArrowUp' && prev) go(prev);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, next?.id, prev?.id]);

  /** Spread on the stage element. A quick, mostly vertical swipe of 60px+ moves. */
  const handlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY, t: Date.now() } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dy = t.clientY - s.y;
      const dx = t.clientX - s.x;
      if (Date.now() - s.t > 700 || Math.abs(dy) < 60 || Math.abs(dx) > Math.abs(dy) * 0.7) return;
      if (dy < 0) go(next);
      else go(prev);
    },
  };

  return { next, prev, goNext: () => go(next), goPrev: () => go(prev), handlers };
}
