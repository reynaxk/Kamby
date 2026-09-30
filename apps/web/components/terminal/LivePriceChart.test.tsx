import type { Candle } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { leadInSlots, seedPoints } from './LivePriceChart';

const at = (iso: string, close: number): Candle => ({ bucketStart: iso, open: close, high: close, low: close, close, volumeUsd: 0 });
const NOW = Math.floor(new Date('2026-09-30T21:00:00Z').getTime() / 1000);

describe('LivePriceChart seeding', () => {
  it('seeds only from recent 1m closes — an hours-old last trade starts the line fresh', () => {
    const seed = seedPoints([at('2026-09-30T10:00:00Z', 1), at('2026-09-30T20:30:00Z', 2), at('2026-09-30T20:31:00Z', 3)], NOW);
    expect(seed.map((p) => p.value)).toEqual([2, 3]);
  });

  it('lays out 2s slots for the last 3 minutes (or since the seed) so the line grows from the right', () => {
    const slots = leadInSlots(null, NOW);
    expect(slots).toHaveLength(90);
    expect(slots[0]!.time).toBe(NOW - 180);
    expect(slots.at(-1)!.time).toBe(NOW - 2);
    expect(leadInSlots(NOW - 10, NOW).map((s) => s.time)).toEqual([NOW - 8, NOW - 6, NOW - 4, NOW - 2]);
  });
});
