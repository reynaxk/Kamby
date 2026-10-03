import { describe, expect, it } from 'vitest';
import { aggregatorCandidate, failsSecurity, type GeckoPool } from './aggregator-markets';

const pool = (over: Partial<NonNullable<GeckoPool['attributes']>> = {}, dex = 'aerodrome-base', name = 'EDEL / WETH'): GeckoPool => ({
  attributes: { address: '0xfb31f85a8367210b2e4ed2360d2da9dc2d2ccc95', name, reserve_in_usd: '1355027', transactions: { h24: { buyers: 300, sellers: 200 } }, ...over },
  relationships: {
    base_token: { data: { id: 'base_0xfb31f85a8367210b2e4ed2360d2da9dc2d2ccc95' } },
    quote_token: { data: { id: 'base_0x4200000000000000000000000000000000000006' } },
    dex: { data: { id: dex } },
  },
});

describe('aggregatorCandidate', () => {
  it('lists the coin side of a liquid, actively traded pool on a DEX Kamby cannot read itself', () => {
    expect(aggregatorCandidate(pool(), ['uniswap-v3-base'])).toMatchObject({ symbol: 'EDEL', dex: 'aerodrome-base' });
  });
  it('skips pools Kamby reads itself, thin pools, quiet pools and major-vs-major pools', () => {
    expect(aggregatorCandidate(pool({}, 'uniswap-v3-base'), ['uniswap-v3-base'])).toBeNull();
    expect(aggregatorCandidate(pool({ reserve_in_usd: '5000' }), [])).toBeNull();
    expect(aggregatorCandidate(pool({ transactions: { h24: { buyers: 3, sellers: 1 } } }), [])).toBeNull();
    expect(aggregatorCandidate(pool({}, 'aerodrome-base', 'WETH / USDC'), [])).toBeNull();
  });
});

describe('failsSecurity', () => {
  it('rejects honeypots, unsellable, pausable or blacklisting tokens and >10% taxes — and anything unchecked', () => {
    expect(failsSecurity({ is_honeypot: '0', buy_tax: '0', sell_tax: '0' })).toBe(false);
    expect(failsSecurity({ is_honeypot: '1' })).toBe(true);
    expect(failsSecurity({ cannot_sell_all: '1' })).toBe(true);
    expect(failsSecurity({ sell_tax: '0.25' })).toBe(true);
    expect(failsSecurity(undefined)).toBe(true);
  });
});
