import { looksLikeScamBait } from '@kamby/domain';
import { normalizeDmBody, orderedPair, systemText, toMessage } from './dm.service';

describe('DmService helpers', () => {
  it('stores a pair of users in one order, however the chat started', () => {
    expect(orderedPair('b-user', 'a-user')).toEqual(['a-user', 'b-user']);
    expect(orderedPair('a-user', 'b-user')).toEqual(['a-user', 'b-user']);
  });

  it('keeps line breaks but trims and caps blank-line walls', () => {
    expect(normalizeDmBody('  gm\r\n\r\n\r\n\r\nwagmi  ')).toBe('gm\n\nwagmi');
  });

  it('turns a coin row into a coin card and leaves the other cards empty', () => {
    const row = {
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u1',
      kind: 'coin',
      body: '',
      data: { chainIdentifier: 'solana', tokenAddress: 'Mint', symbol: 'WIF', name: 'dogwifhat', logoUrl: null },
      reactions: { '🔥': ['u2'] },
      txRef: null,
      createdAt: new Date('2026-10-17T10:00:00Z'),
    };
    const m = toMessage(row as never);
    expect(m.coin?.symbol).toBe('WIF');
    expect(m.pnl).toBeNull();
    expect(m.usdc).toBeNull();
    expect(m.reactions['🔥']).toEqual(['u2']);
  });

  it('flags the classic seed-phrase / fake-support bait, not ordinary chat', () => {
    expect(looksLikeScamBait('hey send me your seed phrase to verify')).toBe(true);
    expect(looksLikeScamBait('I am Kamby support, share your private key')).toBe(true);
    expect(looksLikeScamBait('this coin is going to the moon')).toBe(false);
  });

  it('writes group events as one readable line', () => {
    expect(systemText({ event: 'added', actor: 'sandy', targets: ['tati', 'moonboi'] })).toBe('@sandy added @tati, @moonboi');
    expect(systemText({ event: 'renamed', actor: 'sandy', targets: [], title: 'Degens' })).toBe('@sandy renamed the group to “Degens”');
  });
});
