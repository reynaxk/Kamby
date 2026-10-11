import { describe, expect, it } from 'vitest';
import { pushCopy } from './push-copy';

const facts = { actor: '@sam', token: '$WIF', amount: '$1.2K', pct: '+18%', side: 'BUY' as const };

describe('pushCopy', () => {
  it('fills the facts into the phone language', () => {
    expect(pushCopy('bg', 'TRADE_CONFIRMED', facts)).toEqual({ title: '✅ Сделката е потвърдена', body: 'Ти купи $WIF за $1.2K' });
    expect(pushCopy('en', 'PRICE_MOVE', { ...facts, arrow: '📈' })).toEqual({ title: '📈 $WIF +18%', body: '$WIF moved +18% in the last hour' });
  });

  it('falls back to English for an unknown language', () => {
    expect(pushCopy('xx', 'FOLLOW', facts).body).toBe('@sam started following you');
  });
});
