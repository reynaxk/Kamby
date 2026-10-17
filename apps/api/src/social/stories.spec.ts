import { buildStories } from './stories';

const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 12, m));
const g = (userId: string, token: string, pnlUsd: number, costUsd: number, m: number) => ({ userId, chainIdentifier: 'solana', tokenAddress: token, symbol: token.toUpperCase(), logoUrl: null, pnlUsd, costUsd, at: at(m) });
const people = new Map([
  ['a', { username: 'alice', avatarUrl: null, walletAddress: null }],
  ['b', { username: 'bob', avatarUrl: null, walletAddress: null }],
  ['c', { username: 'carl', avatarUrl: null, walletAddress: null }],
]);

describe('buildStories', () => {
  it('shows only winning coins, newest first, with the gain over what was put in', () => {
    const [alice] = buildStories([g('a', 'wif', 50, 100, 1), g('a', 'bonk', -20, 40, 2), g('a', 'dope', 10, 10, 3)], people, new Set(), '2026-10-17');
    expect(alice!.cards.map((c) => c.symbol)).toEqual(['DOPE', 'WIF']);
    expect(alice!.cards[1]!.pnlPct).toBe(50);
  });

  it('puts people you follow first, then the biggest wins; nobody without a name or a win', () => {
    const out = buildStories([g('a', 'wif', 5, 10, 1), g('b', 'wif', 500, 100, 1), g('c', 'wif', -1, 10, 1), g('x', 'wif', 999, 1, 1)], people, new Set(['a']), '2026-10-17');
    expect(out.map((s) => s.username)).toEqual(['alice', 'bob']);
  });
});
