import { describe, expect, it } from 'vitest';
import { providerLabel, recordRpcRequest, takeRpcUsageSnapshot } from './rpc-usage';

describe('rpc usage meter', () => {
  it('labels providers by host only — never the path where the API key lives', () => {
    expect(providerLabel('https://wild-name.base-mainnet.quiknode.pro/SECRETKEY123/')).toBe('quicknode:base-mainnet');
    expect(providerLabel('https://mainnet.base.org')).toBe('mainnet.base.org');
    expect(providerLabel('https://base-mainnet.g.alchemy.com/v2/SECRET')).toBe('base-mainnet.g.alchemy.com');
    expect(providerLabel('not a url')).toBe('unknown');
  });

  it('counts single and batched calls by method, paid providers flagged, and resets on snapshot', () => {
    takeRpcUsageSnapshot();
    const paid = 'https://x.bsc.quiknode.pro/KEY/';
    recordRpcRequest(paid, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call' }));
    recordRpcRequest(paid, JSON.stringify([{ method: 'eth_call' }, { method: 'eth_getBalance' }]));
    recordRpcRequest('https://mainnet.base.org', JSON.stringify({ method: 'eth_blockNumber' }));

    const snapshot = takeRpcUsageSnapshot();
    expect(snapshot[0]).toEqual({ provider: 'quicknode:bsc', paid: true, total: 3, methods: { eth_call: 2, eth_getBalance: 1 } });
    expect(snapshot[1]).toMatchObject({ provider: 'mainnet.base.org', paid: false, total: 1 });
    expect(JSON.stringify(snapshot)).not.toContain('KEY');
    expect(takeRpcUsageSnapshot()).toEqual([]);
  });
});
