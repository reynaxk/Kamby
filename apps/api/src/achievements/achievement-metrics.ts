import { emptyAchievementMetrics, type AchievementMetrics } from '@kamby/domain';

/** One confirmed trade, either chain. `usd` is the buy's cost or the sell's proceeds when known. */
export interface TradeFact {
  at: Date;
  side: 'BUY' | 'SELL';
  chain: 'solana' | 'base' | 'bnb' | 'robinhood' | 'other';
}

/** One buy lot: a position opened by a buy. */
export interface LotFact {
  id: string;
  token: string;
  acquiredAt: Date;
  costUsd: number;
}

/** One sell, its matched lots already summed. `heldMs` is from the earliest matched lot. */
export interface SellFact {
  token: string;
  at: Date;
  costUsd: number;
  proceedsUsd: number;
  pnlUsd: number;
  heldMs: number;
}

export interface VoteFact {
  correct: boolean | null; // null = not decided yet
  decidedAt: Date | null;
}

export interface OtherFacts {
  pollsCreated: number;
  posts: number;
  likesReceived: number;
  maxPostLikes: number;
  tradeCardPosts: number;
  replies: number;
  likesGiven: number;
  pulseMessages: number;
  dmMessages: number;
  follows: number;
  watchlist: number;
  theses: number;
  referrals: number;
  liveStreams: number;
  peakViewers: number;
  liveHours: number;
  duelsPlayed: number;
  duelsWon: number;
  launches: number;
  longestStreakDays: number;
  createdAt: Date;
  hasUsername: boolean;
  hasAvatar: boolean;
}

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
/** Ignore dust when judging a trade's % so a $0.01 position can't mint a "Hundred Bagger". */
const MIN_PCT_COST_USD = 1;
/** Before 2027: an early account. */
const EARLY_ADOPTER_BEFORE = Date.parse('2027-01-01T00:00:00Z');

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Every achievement metric from a user's real history. Pure, so the rules are tested without a
 * database — AchievementsService only loads the facts. Times are UTC (the server has no user
 * time zone), and the titles say so.
 */
export function computeAchievementMetrics(input: {
  trades: TradeFact[];
  lots: LotFact[];
  sells: SellFact[];
  votes: VoteFact[];
  other: OtherFacts;
  now: Date;
}): AchievementMetrics {
  const m = emptyAchievementMetrics();
  const { trades, lots, sells, votes, other } = input;

  // Trades — counts, chains, days and times of day.
  m.trades = trades.length;
  const perDay = new Map<string, number>();
  const chains = new Set<string>();
  for (const t of trades) {
    if (t.side === 'BUY') m.buys += 1;
    else m.sells += 1;
    if (t.chain === 'solana') m.solanaTrades += 1;
    if (t.chain === 'base') m.baseTrades += 1;
    if (t.chain === 'bnb') m.bnbTrades += 1;
    if (t.chain === 'robinhood') m.robinhoodTrades += 1;
    if (t.chain !== 'other') chains.add(t.chain);
    const day = utcDay(t.at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    const h = t.at.getUTCHours();
    const min = t.at.getUTCMinutes();
    const month = t.at.getUTCMonth() + 1;
    const date = t.at.getUTCDate();
    if (h < 5) m.nightTrades += 1;
    if (h === 3) m.witchingTrades += 1;
    if ((h === 4 || h === 16) && min === 20) m.trades420 += 1;
    if (month === 1 && date === 1 && h === 0) m.newYearTrades += 1;
    if (date === 13 && t.at.getUTCDay() === 5) m.friday13Trades += 1;
    if (month === 10 && date === 31) m.halloweenTrades += 1;
    if (month === 12 && date === 25) m.christmasTrades += 1;
    if (month === 2 && date === 29) m.leapDayTrades += 1;
  }
  m.chainsUsed = chains.size;
  m.tradingDays = perDay.size;
  m.maxTradesInDay = Math.max(0, ...perDay.values());

  // Buys — volume, size, coins, and coins bought back after selling them.
  m.coinsTraded = new Set(lots.map((l) => l.token)).size;
  m.maxBuyUsd = Math.max(0, ...lots.map((l) => l.costUsd));
  const firstSell = new Map<string, number>();
  for (const s of sells) firstSell.set(s.token, Math.min(firstSell.get(s.token) ?? Infinity, s.at.getTime()));
  m.rebuys = lots.filter((l) => l.acquiredAt.getTime() > (firstSell.get(l.token) ?? Infinity)).length;

  // Sells — P&L, best/worst, streaks and holding times.
  m.volumeUsd = lots.reduce((a, l) => a + l.costUsd, 0) + sells.reduce((a, s) => a + s.proceedsUsd, 0);
  m.realizedProfitUsd = Math.max(0, sells.reduce((a, s) => a + s.pnlUsd, 0));
  let streak = 0;
  for (const s of [...sells].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const pct = s.costUsd > 0 ? (s.pnlUsd / s.costUsd) * 100 : 0;
    const judged = s.costUsd >= MIN_PCT_COST_USD;
    if (s.pnlUsd > 0) {
      m.winningSells += 1;
      streak += 1;
      m.winStreak = Math.max(m.winStreak, streak);
      m.bestTradeUsd = Math.max(m.bestTradeUsd, s.pnlUsd);
      if (judged) m.bestTradePct = Math.max(m.bestTradePct, pct);
      if (s.heldMs < 5 * MIN) m.quickFlips += 1;
      if (s.heldMs >= 30 * DAY) m.diamondHands += 1;
    } else {
      streak = 0;
      if (s.pnlUsd < 0) {
        m.lossSells += 1;
        if (judged) m.worstTradeLossPct = Math.max(m.worstTradeLossPct, -pct);
        if (s.heldMs < 10 * MIN) m.panicSells += 1;
      }
    }
    if (s.heldMs >= 90 * DAY) m.longHolds += 1;
    if (s.heldMs < MIN) m.instantFlips += 1;
    if (s.costUsd >= MIN_PCT_COST_USD && Math.abs(s.pnlUsd) < 0.01) m.breakevenSells += 1;
  }

  // Predictions — decided votes in the order they were decided.
  m.predictionVotes = votes.length;
  const decided = votes.filter((v) => v.correct !== null).sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  let run = 0;
  for (const v of decided) {
    if (v.correct) {
      m.predictionsCorrect += 1;
      run += 1;
      m.correctStreak = Math.max(m.correctStreak, run);
    } else {
      m.predictionsWrong += 1;
      run = 0;
    }
  }
  if (decided.length >= 20) m.predictionAccuracy = Math.floor((m.predictionsCorrect / decided.length) * 100);
  m.pollsCreated = other.pollsCreated;

  // Social, live, duels, LaunchPad, loyalty.
  m.posts = other.posts;
  m.likesReceived = other.likesReceived;
  m.maxPostLikes = other.maxPostLikes;
  m.tradeCardPosts = other.tradeCardPosts;
  m.replies = other.replies;
  m.likesGiven = other.likesGiven;
  m.pulseMessages = other.pulseMessages;
  m.dmMessages = other.dmMessages;
  m.follows = other.follows;
  m.watchlist = other.watchlist;
  m.theses = other.theses;
  m.referrals = other.referrals;
  m.liveStreams = other.liveStreams;
  m.peakViewers = other.peakViewers;
  m.liveHours = Math.floor(other.liveHours);
  m.duelsPlayed = other.duelsPlayed;
  m.duelsWon = other.duelsWon;
  m.launches = other.launches;
  m.longestStreakDays = other.longestStreakDays;
  m.accountAgeDays = Math.floor((input.now.getTime() - other.createdAt.getTime()) / DAY);
  m.earlyAdopter = other.createdAt.getTime() < EARLY_ADOPTER_BEFORE ? 1 : 0;
  m.profileComplete = (other.hasUsername ? 1 : 0) + (other.hasAvatar ? 1 : 0);

  for (const k of Object.keys(m) as (keyof AchievementMetrics)[]) {
    if (!Number.isFinite(m[k])) m[k] = 0;
    else m[k] = Math.round(m[k] * 100) / 100;
  }
  return m;
}
