'use client';

import { useEffect, useState } from 'react';
import type { NarrativesSnapshot } from '@kamby/domain';
import { openResilientEventSource } from './resilient-event-source';
import { API_BASE } from './session-client';

/**
 * Narratives (2026-10-31): the Heat Index snapshot, kept live over one shared SSE stream per tab
 * (the API rebuilds it about every 30s) — the Narratives page and the Trade list's narrative pills
 * read the same one.
 */

type Listener = (snapshot: NarrativesSnapshot) => void;
const listeners = new Set<Listener>();
let latest: NarrativesSnapshot | null = null;
let close: (() => void) | null = null;

function connect(): void {
  // No EventSource (an old browser, tests): the server's first paint stays.
  if (typeof EventSource === 'undefined') return;
  close = openResilientEventSource(
    `${API_BASE}/v1/narratives/stream`,
    {
      narratives: (data) => {
        try {
          latest = JSON.parse(data) as NarrativesSnapshot;
        } catch {
          return;
        }
        for (const listener of listeners) listener(latest);
      },
    },
    () => undefined,
  );
}

export function subscribeNarratives(listener: Listener): () => void {
  listeners.add(listener);
  if (latest) listener(latest);
  if (!close) connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && close) {
      close();
      close = null;
    }
  };
}

/** The live snapshot, starting from the server's first paint when there is one. */
export function useNarratives(initial: NarrativesSnapshot | null = null): NarrativesSnapshot | null {
  const [snapshot, setSnapshot] = useState<NarrativesSnapshot | null>(latest ?? initial);
  useEffect(() => subscribeNarratives(setSnapshot), []);
  return snapshot;
}
