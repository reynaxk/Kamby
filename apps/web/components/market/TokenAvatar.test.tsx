import { describe, expect, it } from 'vitest';
import { iconCandidates } from './TokenAvatar';

describe('iconCandidates', () => {
  it('moves any IPFS image onto the fast gateways (ipfs.io rate-limits)', () => {
    const cid = 'bafybeicailrr3iobedoxprzs6evwq3nqxsezdhvxbhpseyhltfmufybxuq';
    expect(iconCandidates(`https://ipfs.io/ipfs/${cid}`)).toEqual([`https://pump.mypinata.cloud/ipfs/${cid}`, `https://ipfs.filebase.io/ipfs/${cid}`]);
    expect(iconCandidates(`ipfs://${cid}`)[0]).toBe(`https://pump.mypinata.cloud/ipfs/${cid}`);
  });

  it('keeps ordinary https images, and drops missing or insecure ones', () => {
    expect(iconCandidates('https://cdn.dexscreener.com/x.png')).toEqual(['https://cdn.dexscreener.com/x.png']);
    expect(iconCandidates(null)).toEqual([]);
    expect(iconCandidates('http://example.com/x.png')).toEqual([]);
  });
});
