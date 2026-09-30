import { pickPrimaryMarket, seedPoolFor } from '@kamby/domain';
import { findPrimaryMarket } from './primary-market';

const BNB = 'eip155:56';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const WBNB_USDC_SEED_POOL = '0xf2688Fb5B81049DFB7703aDa5e770543770612C4';

describe('seedPoolFor / pickPrimaryMarket', () => {
  it("knows a seed token's own pool, whatever the address casing", () => {
    expect(seedPoolFor(BNB, WBNB.toLowerCase())).toBe(WBNB_USDC_SEED_POOL.toLowerCase());
    expect(seedPoolFor(BNB, '0x1111111111111111111111111111111111111111')).toBeNull();
  });

  it('keeps the seed pool over a more liquid duplicate quoted in another coin (the WBNB/BNCB case)', () => {
    const seed = { pairAddress: WBNB_USDC_SEED_POOL, liquidityUsd: 1_000_000, quote: 'USDC' };
    const duplicate = { pairAddress: '0x9999999999999999999999999999999999999999', liquidityUsd: 5_000_000, quote: 'BNCB' };
    expect(pickPrimaryMarket(BNB, WBNB, [duplicate, seed])).toBe(seed);
  });

  it('falls back to the most liquid market for a token with no seed pool', () => {
    const thin = { pairAddress: '0xa', liquidityUsd: 10 };
    const deep = { pairAddress: '0xb', liquidityUsd: 500 };
    expect(pickPrimaryMarket(BNB, '0x1111111111111111111111111111111111111111', [thin, deep])).toBe(deep);
  });
});

describe('findPrimaryMarket', () => {
  it('looks up a seed token by its seed pool first', async () => {
    const find = jest.fn().mockResolvedValue({ id: 'seed' });
    await expect(findPrimaryMarket(BNB, WBNB, find)).resolves.toEqual({ id: 'seed' });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({ chain: { identifier: BNB }, pairAddress: { equals: WBNB_USDC_SEED_POOL.toLowerCase(), mode: 'insensitive' } });
  });

  it('falls back to the token lookup when the seed market is not tracked yet, or for any other token', async () => {
    const find = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'other' });
    await expect(findPrimaryMarket(BNB, WBNB, find)).resolves.toEqual({ id: 'other' });
    expect(find).toHaveBeenLastCalledWith({ chain: { identifier: BNB }, token: { contractAddress: { equals: WBNB, mode: 'insensitive' } } });

    const other = jest.fn().mockResolvedValue({ id: 'x' });
    await findPrimaryMarket(BNB, '0x1111111111111111111111111111111111111111', other);
    expect(other).toHaveBeenCalledTimes(1);
  });
});
