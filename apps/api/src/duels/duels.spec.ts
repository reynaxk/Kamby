import { duelWinner } from '@kamby/domain';
import { scoreLine } from './duels.service';

describe('duels', () => {
  const a = (pct: number | null) => ({ userId: 'a', pct });
  const b = (pct: number | null) => ({ userId: 'b', pct });

  it('the higher % wins; trading beats not trading; equal or nobody is a draw', () => {
    expect(duelWinner(a(12.4), b(-3.1))).toBe('a');
    expect(duelWinner(a(-20), b(-5))).toBe('b');
    expect(duelWinner(a(-50), b(null))).toBe('a');
    expect(duelWinner(a(null), b(null))).toBeNull();
    expect(duelWinner(a(4), b(4))).toBeNull();
  });

  it('writes the result line', () => {
    expect(scoreLine(12.44, -3.1)).toBe('+12.4% vs −3.1%');
    expect(scoreLine(null, 0)).toBe('no trades vs +0.0%');
  });
});
