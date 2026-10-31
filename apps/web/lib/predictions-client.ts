'use client';

import type { Prediction, PredictionCategory, PredictionFilter, PredictionUpdate, PredictionsPage, ProfilePredictions } from '@kamby/domain';
import { openResilientEventSource } from './resilient-event-source';
import { API_BASE, authedFetch, expectOk, hasStoredSession } from './session-client';

/**
 * Predictions (2026-10-31) — free community forecasts, votes only. Reading never creates a
 * session (a signed-out browser reads anonymously); voting and asking do.
 */

export async function fetchPredictions(params: { filter: PredictionFilter; category?: PredictionCategory; before?: string; coin?: { chainIdentifier: string; tokenAddress: string } }): Promise<PredictionsPage> {
  const query = new URLSearchParams({ filter: params.filter });
  if (params.coin) {
    query.set('chain', params.coin.chainIdentifier);
    query.set('address', params.coin.tokenAddress);
  }
  if (params.category) query.set('category', params.category);
  if (params.before) query.set('before', params.before);
  const path = `/predictions?${query.toString()}`;
  const res = hasStoredSession() ? await authedFetch(path) : await fetch(`${API_BASE}/v1${path}`);
  await expectOk(res, 'load predictions');
  return res.json();
}

/** A trader's profile tab: what they asked, what they voted, their hit rate. */
export async function fetchProfilePredictions(address: string): Promise<ProfilePredictions> {
  const path = `/predictions/by/${encodeURIComponent(address)}`;
  const res = hasStoredSession() ? await authedFetch(path) : await fetch(`${API_BASE}/v1${path}`);
  await expectOk(res, 'load predictions');
  return res.json();
}

export async function votePrediction(id: string, option: number): Promise<Prediction> {
  const res = await authedFetch(`/predictions/${encodeURIComponent(id)}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ option }),
  });
  await expectOk(res, 'vote');
  return res.json();
}

export async function createPrediction(input: { title: string; options: string[]; minutes: number; category?: PredictionCategory }): Promise<Prediction> {
  const res = await authedFetch('/predictions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  await expectOk(res, 'ask your question');
  return res.json();
}

/** Live vote counts, outcomes and new polls. */
export function subscribePredictions(handlers: { onUpdate: (u: PredictionUpdate) => void; onCreated: (p: Prediction) => void }): () => void {
  if (typeof EventSource === 'undefined') return () => undefined;
  return openResilientEventSource(
    `${API_BASE}/v1/predictions/stream`,
    {
      update: (data) => {
        try {
          handlers.onUpdate(JSON.parse(data) as PredictionUpdate);
        } catch {
          // one malformed event
        }
      },
      created: (data) => {
        try {
          handlers.onCreated(JSON.parse(data) as Prediction);
        } catch {
          // one malformed event
        }
      },
    },
    () => undefined,
  );
}
