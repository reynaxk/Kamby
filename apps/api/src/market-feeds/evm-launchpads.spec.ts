import { evmPoolToken, launchpadOf, type GtPool, type GtToken } from './evm-launchpads';

const now = Date.parse('2026-11-01T09:00:00Z');
const pool = (patch: Partial<GtPool['attributes']> = {}, dex = 'four-meme', token = '0x1111111111111111111111111111111111114444'): GtPool => ({
  id: 'bsc_0xpool',
  attributes: { pool_created_at: '2026-11-01T08:55:00Z', reserve_in_usd: '5000', fdv_usd: '20000', volume_usd: { m5: '800' }, transactions: { m5: { buys: 12, sells: 4, buyers: 9, sellers: 3 } }, ...patch },
  relationships: { base_token: { data: { id: `bsc_${token}` } }, dex: { data: { id: dex } } },
});
const tokens = new Map<string, GtToken>([['bsc_0x1111111111111111111111111111111111114444', { id: 'bsc_0x1111111111111111111111111111111111114444', type: 'token', attributes: { address: '0x1111111111111111111111111111111111114444', symbol: 'FOUR', name: 'Four', image_url: null } }]]);

describe('EVM launchpads', () => {
  it('labels the launchpad only where it is certain', () => {
    expect(launchpadOf('four-meme', '0xabc')).toEqual({ launchpad: 'four.meme', column: 'new' });
    expect(launchpadOf('pancakeswap_v2', '0xabc4444')).toEqual({ launchpad: 'four.meme', column: 'migrated' });
    expect(launchpadOf('uniswap-v4-base', '0x960b42d0Db862af3102672A2e20bB5267FDb0B07').launchpad).toBe('clanker');
    expect(launchpadOf('pons-v2', '0xabc').launchpad).toBe('pons');
    expect(launchpadOf('pancakeswap_v2', '0xabc7777')).toEqual({ launchpad: 'flap', column: 'migrated' });
    expect(launchpadOf('uniswap-v4-base', '0xabc').launchpad).toBe('uniswap-v4');
  });

  it('makes an unaudited card from a fresh, priced pool and skips thin or old ones', () => {
    const t = evmPoolToken(pool(), tokens, 'eip155:56', now)!;
    expect(t).toMatchObject({ chainIdentifier: 'eip155:56', symbol: 'FOUR', launchpad: 'four.meme', ageSeconds: 300, buys5m: 12, riskFlags: ['unverified-audit'] });
    expect(evmPoolToken(pool({ reserve_in_usd: '200' }), tokens, 'eip155:56', now)).toBeNull();
    expect(evmPoolToken(pool({ pool_created_at: '2026-10-30T08:00:00Z' }), tokens, 'eip155:56', now)).toBeNull();
  });
});
