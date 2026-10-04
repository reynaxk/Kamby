import { curveValuesUsd, riskFlags } from './xxxrisk.service';

describe('XXXRisk helpers', () => {
  it('prices a curve from its reserves: SOL in the curve as liquidity, implied price x supply as market cap', () => {
    const v = curveValuesUsd(
      { mintAddress: 'm', symbol: null, name: null, createdAt: new Date(), virtualSolReserves: '40000000000', virtualTokenReserves: '800000000000000', realSolReserves: '10000000000', tokenTotalSupply: '1000000000000000' },
      150,
    );
    expect(v.liquidityUsd).toBeCloseTo(1500); // 10 SOL x $150
    expect(v.marketCapUsd).toBeCloseTo(7500); // (40 / 800M) SOL x 1B x $150
  });
  it('flags mintable / freezable / dev-heavy / concentrated coins, and unaudited ones', () => {
    expect(riskFlags({ id: 'x', audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, devBalancePercentage: 1, topHoldersPercentage: 10 } })).toEqual([]);
    expect(riskFlags({ id: 'x', audit: { mintAuthorityDisabled: false, freezeAuthorityDisabled: false, devBalancePercentage: 30, topHoldersPercentage: 70 } })).toEqual([
      'mintable',
      'freezable',
      'dev-holds-over-20pct',
      'top-holders-over-50pct',
    ]);
    expect(riskFlags(undefined)).toEqual(['unverified-audit']);
  });
});
