import { describe, expect, it } from 'vitest';
import { isOffensiveCoin, isOffensiveText, withoutOffensiveCoins } from './offensive-names';

describe('isOffensiveText', () => {
  it('catches slurs through casing, symbols and digit swaps', () => {
    expect(isOffensiveText('NIGGARACKET')).toBe(true);
    expect(isOffensiveText('N1GG3R coin')).toBe(true);
    expect(isOffensiveText('f.a.g.g.o.t')).toBe(true);
  });
  it('leaves ordinary words alone', () => {
    for (const word of ['Raccoon', 'Spicy', 'Pickle', 'BONK', 'Gookie']) {
      expect(isOffensiveText(word)).toBe(false);
    }
  });
  it('counts short stems only as whole words', () => {
    expect(isOffensiveText('coon')).toBe(true);
    expect(isOffensiveText('raccoon')).toBe(false);
  });
});

describe('withoutOffensiveCoins', () => {
  it('drops matching rows from every list', () => {
    const out = withoutOffensiveCoins({ markets: [{ symbol: 'WIF' }, { symbol: 'NIGGA' }], atIso: 'x' });
    expect(out.markets).toEqual([{ symbol: 'WIF' }]);
    expect(isOffensiveCoin({ name: 'Hitler Inu' })).toBe(true);
  });
});
