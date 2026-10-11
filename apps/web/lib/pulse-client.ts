'use client';

import type { PulseMessage, PulsePage } from '@kamby/domain';
import { API_BASE, authedFetch } from './session-client';

/** Pulse, the worldwide chat — reads are public, posting needs the signed-in session. */
export async function fetchPulse(before?: string): Promise<PulsePage> {
  const res = await fetch(`${API_BASE}/v1/pulse/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`);
  if (!res.ok) throw new Error(`Pulse ${res.status}`);
  return res.json();
}

export async function postPulse(body: string): Promise<PulseMessage> {
  const res = await authedFetch('/pulse/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
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
  return res.json();
}

export const PULSE_STREAM_URL = `${API_BASE}/v1/pulse/stream`;
