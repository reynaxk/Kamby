import { rankSquads } from './squads';

const squad = (id: string, volumeUsd: number, winRate: number | null, closedTrades: number, memberCount = 3) => ({
  conversationId: id,
  title: id,
  about: null,
  visibility: 'public' as const,
  memberCount,
  volumeUsd,
  swaps: 0,
  winRate,
  closedTrades,
  topToken: null,
});

describe('rankSquads', () => {
  it('ranks by volume, biggest first', () => {
    expect(rankSquads([squad('a', 100, 0.9, 10), squad('b', 900, 0.1, 10)], 'volume').map((s) => s.conversationId)).toEqual(['b', 'a']);
  });
  it('ranks by win rate, but a squad needs enough closed trades to lead', () => {
    const ranked = rankSquads([squad('lucky', 50, 1, 1), squad('steady', 500, 0.7, 20), squad('sharp', 300, 0.8, 8)], 'winrate');
    expect(ranked.map((s) => s.conversationId)).toEqual(['sharp', 'steady', 'lucky']);
  });
});
