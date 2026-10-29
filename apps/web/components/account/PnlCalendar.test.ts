import { describe, expect, it } from 'vitest';
import { calendarDays } from './PnlCalendar';

describe('calendarDays', () => {
  it('lays out whole weeks from a Monday up to today, with each day’s realized PnL', () => {
    const today = new Date('2026-10-29T12:00:00Z'); // a Thursday
    const days = calendarDays({ days: 35, points: [{ date: '2026-10-28', realizedPnlUsd: 4.2, cumulativeRealizedPnlUsd: 4.2 }, { date: '2026-10-27', realizedPnlUsd: 0, cumulativeRealizedPnlUsd: 0 }] }, today);
    expect(days[0]!.date).toBe('2026-09-28'); // Monday, four weeks earlier
    expect(days.at(-1)!.date).toBe('2026-10-29');
    expect(days.length).toBe(32);
    expect(days.find((d) => d.date === '2026-10-28')!.pnl).toBe(4.2);
    expect(days.find((d) => d.date === '2026-10-27')!.pnl).toBeNull();
  });
});
