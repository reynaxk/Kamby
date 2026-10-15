'use client';

import type { Launch, LaunchInput, LaunchProof, LaunchStep } from '@kamby/domain';
import { API_BASE, authedFetch } from './session-client';

export interface LaunchpadConfig {
  feeUsd: number;
  launchpads: { id: LaunchInput['launchpad']; chainIdentifier: string; chainName: string; name: string; live: boolean }[];
  devBuyPresetsUsd: number[];
  maxDevBuyUsd: number;
}

async function ok<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Something went wrong (${res.status})`;
    try {
      const json = (await res.json()) as { message?: string | string[] };
      if (json.message) message = Array.isArray(json.message) ? json.message[0]! : json.message;
    } catch {
      // keep the fallback
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const post = (path: string, body?: unknown) =>
  authedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchLaunchpadConfig = () => fetch(`${API_BASE}/v1/launchpad/config`).then((r) => ok<LaunchpadConfig>(r));

export async function uploadLaunchImage(file: File): Promise<{ imageId: string; imageUrl: string }> {
  const body = new FormData();
  body.append('file', file);
  return ok(await authedFetch('/launchpad/assets', { method: 'POST', body }));
}

export const prepareLaunch = async (input: LaunchInput) => ok<LaunchStep>(await post('/launchpad/launches', input));
export const fundLaunch = async (id: string, proof: LaunchProof) => ok<Launch>(await post(`/launchpad/launches/${id}/fund`, proof));
export const buildLaunchCreate = async (id: string) => ok<LaunchStep>(await post(`/launchpad/launches/${id}/create`));
export const submitLaunch = async (id: string, proof: LaunchProof) => ok<Launch>(await post(`/launchpad/launches/${id}/submit`, proof));
export const fetchMyLaunches = async () => ok<Launch[]>(await authedFetch('/launchpad/launches/mine'));
