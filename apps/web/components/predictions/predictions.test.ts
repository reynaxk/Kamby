import type { Prediction } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { countdown } from './PredictionCard';
import { applyUpdate } from './PredictionsView';

describe('predictions UI', () => {
  it('counts down and stops at the end', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(countdown('2026-10-31T14:14:30Z', now)).toBe('2h 14m');
    expect(countdown('2026-10-31T12:14:05Z', now)).toBe('14m 05s');
    expect(countdown('2026-11-02T13:00:00Z', now)).toBe('2d 1h');
    expect(countdown('2026-10-31T11:59:59Z', now)).toBeNull();
  });

  it('folds live counts and outcomes into the list', () => {
    const p = { id: 'a', counts: [1, 0], total: 1, status: 'ACTIVE', resolvedOptionIndex: null } as unknown as Prediction;
    const [next] = applyUpdate([p], { id: 'a', counts: [1, 2], total: 3, status: 'RESOLVED', resolvedOptionIndex: 1 });
    expect(next).toMatchObject({ counts: [1, 2], total: 3, status: 'RESOLVED', resolvedOptionIndex: 1 });
    expect(applyUpdate([p], { id: 'zzz', counts: [9, 9], total: 18 })[0]).toBe(p);
  });
});
