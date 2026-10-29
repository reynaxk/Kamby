import { describe, expect, it } from 'vitest';
import type { SocialActivity } from '@kamby/domain';
import { trackRows } from './TrackFeed';

const row = (id: string, symbol: string, amountUsd: number, timestamp: string) => ({ id, token: { symbol }, amountUsd, timestamp }) as unknown as SocialActivity;

describe('trackRows', () => {
  it('keeps real coins above the size, newest first, drops router legs and repeats', () => {
    const rows = trackRows(
      [row('a', 'CASHCAT', 499, '2026-10-29T05:16:51Z'), row('b', 'WETH', 5000, '2026-10-29T05:16:52Z'), row('c', 'PEPE', 50, '2026-10-29T05:16:53Z'), row('d', 'DOG', 2000, '2026-10-29T05:16:54Z'), row('d', 'DOG', 2000, '2026-10-29T05:16:54Z')],
      100,
    );
    expect(rows.map((r) => r.id)).toEqual(['d', 'a']);
  });
});
