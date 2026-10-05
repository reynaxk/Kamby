import { fromGoPlus, markSolanaPrograms } from './holders.service';

describe('fromGoPlus', () => {
  it('maps EVM and Solana holder rows into percentages of supply, largest first', () => {
    const result = fromGoPlus({
      holder_count: '754075',
      holders: [
        { address: '0xsmall', balance: '10', percent: '0.01', is_contract: 0, tag: '' },
        { account: 'SolOwner', balance: '500', percent: '0.4983', is_contract: 1, tag: 'Pool' },
      ],
    });
    expect(result?.holderCount).toBe(754075);
    expect(result?.holders[0]).toMatchObject({ address: 'SolOwner', balance: 500, isContract: true, tag: 'Pool' });
    expect(result?.holders[0]?.percent).toBeCloseTo(49.83);
    expect(result?.holders[1]).toMatchObject({ address: '0xsmall', percent: 1, isContract: false, tag: null });
  });

  it('drops malformed rows and returns null when nothing usable is left', () => {
    expect(fromGoPlus({ holders: [{ address: 'x', balance: 'n/a', percent: '0.1' }] })).toBeNull();
    expect(fromGoPlus(undefined)).toBeNull();
  });
});

describe('markSolanaPrograms', () => {
  it('labels program-owned (off-curve) addresses as a pool, never a person', () => {
    const { PublicKey, Keypair } = jest.requireActual('@solana/web3.js') as typeof import('@solana/web3.js');
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from('bonding-curve')], new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'));
    const person = Keypair.generate().publicKey.toBase58();
    const out = markSolanaPrograms({
      holderCount: null,
      atIso: '',
      holders: [
        { address: pda.toBase58(), balance: 1, percent: 36, isContract: false, tag: null },
        { address: person, balance: 1, percent: 3, isContract: false, tag: null },
      ],
    });
    expect(out.holders[0]).toMatchObject({ isContract: true, tag: 'Pool / curve' });
    expect(out.holders[1]).toMatchObject({ isContract: false, tag: null });
  });
});
