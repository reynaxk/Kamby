import { ACHIEVEMENTS, evaluateAchievements } from '@kamby/domain';
import { computeAchievementMetrics, type OtherFacts } from './achievement-metrics';

const other: OtherFacts = {
  pollsCreated: 0, posts: 0, likesReceived: 0, maxPostLikes: 0, tradeCardPosts: 0, replies: 0, likesGiven: 0, pulseMessages: 0,
  dmMessages: 0, follows: 0, watchlist: 0, theses: 0, referrals: 0, liveStreams: 0, peakViewers: 0, liveHours: 0, duelsPlayed: 0,
  duelsWon: 0, launches: 0, longestStreakDays: 0, createdAt: new Date('2026-10-01T00:00:00Z'), hasUsername: true, hasAvatar: false,
};
const now = new Date('2026-11-01T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('computeAchievementMetrics', () => {
  it('counts trades, chains, times of day and P&L from real facts', () => {
    const m = computeAchievementMetrics({
      now,
      other,
      trades: [
        { at: at('2026-10-31T04:20:10Z'), side: 'BUY', chain: 'solana' },
        { at: at('2026-10-31T04:22:00Z'), side: 'SELL', chain: 'solana' },
        { at: at('2026-10-30T15:00:00Z'), side: 'BUY', chain: 'base' },
      ],
      lots: [
        { id: 'a', token: 'sol:X', acquiredAt: at('2026-10-31T04:20:10Z'), costUsd: 10 },
        { id: 'b', token: 'base:Y', acquiredAt: at('2026-10-30T15:00:00Z'), costUsd: 50 },
      ],
      sells: [{ token: 'sol:X', at: at('2026-10-31T04:22:00Z'), costUsd: 10, proceedsUsd: 25, pnlUsd: 15, heldMs: 110_000 }],
      votes: [{ correct: true, decidedAt: at('2026-10-30T00:00:00Z') }, { correct: null, decidedAt: null }],
    });
    expect(m).toMatchObject({
      trades: 3, buys: 2, sells: 1, chainsUsed: 2, solanaTrades: 2, baseTrades: 1, nightTrades: 2, trades420: 1, halloweenTrades: 2,
      volumeUsd: 85, realizedProfitUsd: 15, winningSells: 1, bestTradePct: 150, quickFlips: 1, instantFlips: 0, coinsTraded: 2,
      predictionVotes: 2, predictionsCorrect: 1, accountAgeDays: 31, earlyAdopter: 1, profileComplete: 1,
    });
  });

  it('flags quick losses as panic sells and ignores dust for percentages', () => {
    const m = computeAchievementMetrics({
      now, other, trades: [], lots: [], votes: [],
      sells: [
        { token: 't', at: now, costUsd: 20, proceedsUsd: 4, pnlUsd: -16, heldMs: 60_000 },
        { token: 'u', at: now, costUsd: 0.01, proceedsUsd: 5, pnlUsd: 4.99, heldMs: 60_000 },
      ],
    });
    expect(m.panicSells).toBe(1);
    expect(m.worstTradeLossPct).toBe(80);
    expect(m.bestTradePct).toBe(0);
  });
});

describe('evaluateAchievements', () => {
  it('has 250 titles and counts the meta title from the first pass', () => {
    expect(ACHIEVEMENTS).toHaveLength(250);
    const m = computeAchievementMetrics({ now, other: { ...other, posts: 60, likesReceived: 120, follows: 12, watchlist: 12 }, trades: [], lots: [], sells: [], votes: [] });
    const r = evaluateAchievements(m);
    const hunter = r.find((x) => x.id === 'badge-hunter')!;
    expect(hunter.progress).toBeGreaterThanOrEqual(10);
    expect(hunter.unlocked).toBe(true);
  });
});
