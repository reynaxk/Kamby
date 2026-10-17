import { describe, expect, it } from 'vitest';
import { dmPushCopy, pushCopy } from './push-copy';

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

describe('dmPushCopy', () => {
  it('reads like a chat app: the line in a private chat, "@name: line" in a group', () => {
    expect(dmPushCopy('en', { actor: 'tati', dmKind: 'message', chatTitle: null, preview: 'gm', emoji: '' })).toEqual({ title: '💬 @tati', body: 'gm' });
    expect(dmPushCopy('en', { actor: 'tati', dmKind: 'message', chatTitle: 'Kamby Whales', preview: 'gm', emoji: '' })).toEqual({ title: '💬 Kamby Whales', body: '@tati: gm' });
  });
  it('says what happened for mentions and reactions, in the phone language', () => {
    expect(dmPushCopy('bg', { actor: 'tati', dmKind: 'mention', chatTitle: 'Whales', preview: 'yo @sandy', emoji: '' }).body).toBe('@tati те спомена: yo @sandy');
    expect(dmPushCopy('xx', { actor: 'tati', dmKind: 'reaction', chatTitle: null, preview: 'gm', emoji: '🔥' }).body).toBe('@tati reacted 🔥 to “gm”');
  });
});
