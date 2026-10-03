import { describe, expect, it } from 'vitest';
import { passesSafety, type JupiterToken } from './jupiter-solana-discovery';

const good: JupiterToken = {
  id: 'Mint1111111111111111111111111111111111111111',
  symbol: 'GOOD',
  usdPrice: 0.001,
  liquidity: 50_000,
  holderCount: 800,
  organicScoreLabel: 'medium',
  audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devBalancePercentage: 2 },
};

describe('passesSafety', () => {
  it('lists a coin with real trading, no authorities, liquidity and holders', () => {
    expect(passesSafety(good)).toBe(true);
  });
  it('rejects wash-traded, mintable/freezable, thin, tiny or dev-heavy coins', () => {
    expect(passesSafety({ ...good, organicScoreLabel: 'low' })).toBe(false);
    expect(passesSafety({ ...good, audit: { ...good.audit, mintAuthorityDisabled: false } })).toBe(false);
    expect(passesSafety({ ...good, audit: { ...good.audit, freezeAuthorityDisabled: false } })).toBe(false);
    expect(passesSafety({ ...good, liquidity: 5_000 })).toBe(false);
    expect(passesSafety({ ...good, holderCount: 10 })).toBe(false);
    expect(passesSafety({ ...good, audit: { ...good.audit, devBalancePercentage: 35 } })).toBe(false);
  });
});
