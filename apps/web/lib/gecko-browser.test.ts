import { describe, expect, it } from 'vitest';
import { toTrades } from './gecko-browser';

const COIN = 'CoinMint111';
const row = (over: Record<string, unknown>) => ({
  attributes: { tx_hash: 'h1', block_timestamp: '2026-10-10T10:00:00Z', volume_in_usd: '12.5', tx_from_address: 'trader1', from_token_address: 'So111', to_token_address: COIN, ...over },
});

describe('toTrades', () => {
  it('reads the side from which way the coin moved, whichever side of the pool it is', () => {
    const trades = toTrades([row({}), row({ tx_hash: 'h2', from_token_address: COIN, to_token_address: 'So111', block_timestamp: '2026-10-10T10:01:00Z' })], COIN);
    expect(trades.map((t) => [t.txHash, t.side])).toEqual([['h2', 'SELL'], ['h1', 'BUY']]);
    expect(trades[1]).toMatchObject({ amountUsd: 12.5, trader: 'trader1' });
  });

  it('skips rows that are not this coin or are malformed', () => {
    expect(toTrades([row({ to_token_address: 'Other', from_token_address: 'Other2' }), row({ volume_in_usd: 'x' }), { nope: 1 }], COIN)).toEqual([]);
    expect(toTrades(null, COIN)).toEqual([]);
  });
});
