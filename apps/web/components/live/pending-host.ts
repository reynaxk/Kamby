'use client';

import type { LiveRoom } from '@kamby/domain';

/** The Go-live sheet starts the room, then the room page picks the host session up from here
 *  (one hand-over per page load — a reload can't re-attach the host's session). */
interface PendingHost {
  me: string;
  join: { room: LiveRoom; sessionId: string; iceServers: RTCIceServer[] };
}

const pending = new Map<string, PendingHost>();

export function setPendingHost(id: string, value: PendingHost): void {
  pending.set(id, value);
}

export function takePendingHost(id: string): PendingHost | null {
  const v = pending.get(id) ?? null;
  pending.delete(id);
  return v;
}
