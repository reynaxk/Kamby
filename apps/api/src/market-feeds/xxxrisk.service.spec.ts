import { curveValuesUsd, gemsToken, riskFlags, socialsOf, sortColumn } from './xxxrisk.service';

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
  it('keeps only https socials', () => {
    expect(socialsOf({ id: 'x', twitter: 'https://x.com/a', telegram: 'javascript:alert(1)', website: '' })).toEqual({ twitter: 'https://x.com/a' });
    expect(socialsOf(undefined)).toEqual({});
  });

  it('turns a launchpad-board pool into a card, and drops one without a price', () => {
    const now = Date.parse('2026-10-28T20:00:00Z');
    const pool = {
      liquidity: 3400,
      bondingCurve: 42.5,
      baseAsset: {
        id: 'Mint1',
        symbol: 'ASO',
        launchpad: 'met-dbc',
        mcap: 9100,
        createdAt: '2026-10-28T19:59:00Z',
        icon: 'http://insecure.example/a.png',
        audit: { mintAuthorityDisabled: true, freezeAuthorityDisabled: true, sniperPct: 4.7, insiderPct: 2, bundlerStats: { holdingPct: 11.6 } },
        stats5m: { buyVolume: 150, sellVolume: 50, numBuys: 3, numSells: 1 },
      },
    };
    const token = gemsToken(pool, 'soon', now)!;
    expect(token).toMatchObject({ mintAddress: 'Mint1', column: 'soon', launchpad: 'met-dbc', ageSeconds: 60, curvePct: 42.5, volume5mUsd: 200, snipersPct: 4.7, bundlersPct: 11.6, imageUrl: null, riskFlags: [] });
    expect(gemsToken(pool, 'migrated', now)!.curvePct).toBe(100);
    expect(gemsToken({ baseAsset: { id: 'x' } }, 'new', now)).toBeNull();
  });

  it('orders each column its own way', () => {
    const t = (mintAddress: string, extra: object) => ({ mintAddress, ageSeconds: 0, ...extra }) as never;
    expect(sortColumn('new', [t('a', { ageSeconds: 50 }), t('b', { ageSeconds: 5 })]).map((x: { mintAddress: string }) => x.mintAddress)).toEqual(['b', 'a']);
    expect(sortColumn('soon', [t('a', { curvePct: 40 }), t('b', { curvePct: 90 })]).map((x: { mintAddress: string }) => x.mintAddress)).toEqual(['b', 'a']);
    expect(sortColumn('migrated', [t('a', { graduatedAtMs: 1 }), t('b', { graduatedAtMs: 2 })]).map((x: { mintAddress: string }) => x.mintAddress)).toEqual(['b', 'a']);
  });
});
