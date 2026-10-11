import { describe, expect, it } from 'vitest';
import { containsLink, normalizePulseBody } from './pulse';

describe('pulse rules', () => {
  it('spots links in every common disguise', () => {
    for (const text of ['claim at https://x.co', 'www.airdrop.xyz now', 'join t.me/pumpgroup', 'discord.gg/abc', 'go to kamby-airdrop.com', 'visit solana-drop.fun']) {
      expect(containsLink(text)).toBe(true);
    }
  });

  it('lets normal coin talk through', () => {
    for (const text of ['$WIF looks ready to run 🚀', 'bought 2.5k of $BONK', 'who else is in $USMS?', 'gm, 0.5 sol in', 'CA: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm']) {
      expect(containsLink(text)).toBe(false);
    }
  });

  it('collapses whitespace walls', () => {
    expect(normalizePulseBody('  gm \n\n\n   frens   ')).toBe('gm frens');
  });
});
