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
  /** The answer picked, its share of all votes on the poll (0–1), and the poll's coin / window. */
  label?: string;
  share?: number;
  optionIndex?: number;
  pollToken?: string | null;
  openFrom?: Date;
  openUntil?: Date;
}

/** A trade that failed on-chain. */
export interface FailedFact {
  at: Date;
  side: 'BUY' | 'SELL';
  token: string | null;
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
  // The owner's 50 (2026-11-01).
  followers?: number;
  messageTimes?: Date[];
  questionsAsked?: number;
  communitiesTalkedIn?: number;
  reactionsReceived?: number;
  laughsReceived?: number;
  memePosts?: number;
  chartPostLikes?: number[];
  equippedRarity?: string | null;
  /** When Kamby's first account was made (its "first week"). */
  kambyStartAt?: Date;
  /** Distinct calendar months with a trade or a post. */
  activeMonths?: number;
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
  failed?: FailedFact[];
  /** Metrics the service counts itself (they need other users' rows) or that the app reports. */
  extra?: Partial<AchievementMetrics>;
}): AchievementMetrics {
  const m = emptyAchievementMetrics();
  const { trades, lots, sells, votes, other } = input;
  const failed = input.failed ?? [];

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

  owners50(m, input.now, trades, lots, sells, votes, other, failed);
  Object.assign(m, input.extra ?? {});

  for (const k of Object.keys(m) as (keyof AchievementMetrics)[]) {
    if (!Number.isFinite(m[k])) m[k] = 0;
    else m[k] = Math.round(m[k] * 100) / 100;
  }
  return m;
}

const LAUNCH_AT = Date.parse('2026-11-20T00:00:00Z');
const BEARISH = /\b(down|below|lower|red|dump|drop|fall|under|no)\b/i;
const BULLISH = /\b(up|above|higher|green|pump|rise|over|yes)\b/i;

function maxInWindow(times: number[], windowMs: number): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; j < t.length; j++) {
    while (t[j]! - t[i]! > windowMs) i++;
    best = Math.max(best, j - i + 1);
  }
  return best;
}

/** The owner's 50 titles (2026-11-01) — every one counted from the same real facts. */
function owners50(
  m: AchievementMetrics,
  now: Date,
  trades: TradeFact[],
  lots: LotFact[],
  sells: SellFact[],
  votes: VoteFact[],
  other: OtherFacts,
  failed: FailedFact[],
): void {
  const pctOf = (x: SellFact) => (x.costUsd > 0 ? (x.pnlUsd / x.costUsd) * 100 : 0);
  const ordered = [...sells].sort((a, b) => a.at.getTime() - b.at.getTime());

  for (const x of ordered) {
    const pct = pctOf(x);
    const judged = x.costUsd >= MIN_PCT_COST_USD;
    const bought = x.at.getTime() - x.heldMs;
    if (x.pnlUsd < 0 && utcDay(new Date(bought)) !== utcDay(x.at)) m.lossAfterMidnight += 1;
    if (judged && pct <= -99) m.wipeouts += 1;
    if (x.pnlUsd < 0) m.maxLossHoldHours = Math.max(m.maxLossHoldHours, Math.floor(x.heldMs / 3600_000));
    if (judged && pct <= -90 && x.heldMs <= DAY) m.rugSurvivals += 1;
    if (x.costUsd < 1 && x.costUsd > 0 && x.proceedsUsd > 100) m.zeroToHero += 1;
    if (x.heldMs < 3000) m.quantumFlips += 1;
    if (judged && pct <= -95 && x.heldMs < 5 * MIN) m.speedrunZero += 1;
    if (x.pnlUsd > 0 && x.at.getUTCDate() === 13 && x.at.getUTCDay() === 5) m.friday13Wins += 1;
    if (judged && pct > 0 && pct < 0.5) m.paperHandsSupreme += 1;
    if (Math.abs(x.proceedsUsd - 7.77) < 0.005) m.lucky777 += 1;
  }
  for (const l of lots) if (Math.abs(l.costUsd - 7.77) < 0.005) m.lucky777 += 1;

  // Fake bottoms: a loss on a coin, a buy back, then another 50%+ loss on it.
  const lossAt = new Map<string, number>();
  for (const x of ordered) {
    const first = lossAt.get(x.token);
    if (first !== undefined && pctOf(x) <= -50 && lots.some((l) => l.token === x.token && l.acquiredAt.getTime() > first && l.acquiredAt.getTime() < x.at.getTime())) m.fakeBottoms += 1;
    if (x.pnlUsd < 0 && first === undefined) lossAt.set(x.token, x.at.getTime());
  }

  // Mood swings: buy/sell flips on one coin, 3 switches within 10 minutes.
  const sides = new Map<string, { t: number; side: 'B' | 'S' }[]>();
  for (const l of lots) (sides.get(l.token) ?? sides.set(l.token, []).get(l.token)!).push({ t: l.acquiredAt.getTime(), side: 'B' });
  for (const x of sells) (sides.get(x.token) ?? sides.set(x.token, []).get(x.token)!).push({ t: x.at.getTime(), side: 'S' });
  for (const list of sides.values()) {
    list.sort((a, b) => a.t - b.t);
    const flips: number[] = [];
    for (let i = 1; i < list.length; i++) if (list[i]!.side !== list[i - 1]!.side) flips.push(list[i]!.t);
    if (maxInWindow(flips, 10 * MIN) >= 3) m.moodSwings += 1;
  }

  // Early bird streak: consecutive UTC days with a trade before 06:00.
  const early = [...new Set(trades.filter((t) => t.at.getUTCHours() < 6).map((t) => utcDay(t.at)))].sort();
  let run = 0;
  for (let i = 0; i < early.length; i++) {
    run = i > 0 && Date.parse(early[i]!) - Date.parse(early[i - 1]!) === DAY ? run + 1 : 1;
    m.earlyBirdStreak = Math.max(m.earlyBirdStreak, run);
  }
  m.tradesIn2Min = maxInWindow(trades.map((t) => t.at.getTime()), 2 * MIN);
  m.nightTrades0420 = trades.filter((t) => t.at.getUTCHours() === 4 && t.at.getUTCMinutes() === 20).length;

  m.failedTrades = failed.length;
  m.ghostOrders = failed.filter((f) => f.side === 'BUY').length;
  m.snipeMisses = failed.filter(
    (f) => f.side === 'BUY' && f.token && lots.some((l) => l.token === f.token && l.acquiredAt.getTime() >= f.at.getTime() && l.acquiredAt.getTime() - f.at.getTime() <= MIN),
  ).length;

  // Predictions: streaks by answer, majority / contrarian calls, two-faced votes.
  const decided = votes.filter((v) => v.correct !== null).sort((a, b) => (a.decidedAt?.getTime() ?? 0) - (b.decidedAt?.getTime() ?? 0));
  let hope = 0;
  let doom = 0;
  for (const v of decided) {
    const label = v.label ?? '';
    hope = BULLISH.test(label) && !v.correct ? hope + 1 : 0;
    doom = BEARISH.test(label) && v.correct ? doom + 1 : 0;
    m.hopiumStreak = Math.max(m.hopiumStreak, hope);
    m.doomStreak = Math.max(m.doomStreak, doom);
    if (v.correct && v.share !== undefined && v.share <= 0.1) m.galaxyBrain += 1;
  }
  m.echoVotes = votes.filter((v) => v.share !== undefined && v.share >= 0.8).length;
  const coinVotes = votes.filter((v) => v.pollToken && v.openFrom && v.openUntil && v.optionIndex !== undefined);
  outer: for (let i = 0; i < coinVotes.length; i++) {
    for (let j = i + 1; j < coinVotes.length; j++) {
      const a = coinVotes[i]!;
      const b = coinVotes[j]!;
      if (a.pollToken === b.pollToken && a.optionIndex !== b.optionIndex && a.openFrom! < b.openUntil! && b.openFrom! < a.openUntil!) {
        m.doubleAgent = 1;
        break outer;
      }
    }
  }

  // After the first 100 sells: as many wins as losses.
  if (ordered.length >= 100) {
    const first = ordered.slice(0, 100);
    const wins = first.filter((x) => x.pnlUsd > 0).length;
    const losses = first.filter((x) => x.pnlUsd < 0).length;
    m.chaoticNeutral = wins === losses ? 1 : 0;
  }

  // Social.
  const words = other.posts + other.replies + other.pulseMessages + other.dmMessages;
  m.antiSocialTrades = words === 0 ? trades.length : 0;
  m.silentWhaleVolume = (other.followers ?? 0) === 0 && other.posts === 0 ? m.volumeUsd : 0;
  m.memeAlchemy = (other.chartPostLikes ?? []).filter((n) => n >= 50).length;
  m.messagesInHour = maxInWindow((other.messageTimes ?? []).map((d) => d.getTime()), 60 * MIN);
  m.reactionsReceived = other.reactionsReceived ?? 0;
  m.laughsReceived = other.laughsReceived ?? 0;
  m.lurkerDays = words === 0 ? m.accountAgeDays : 0;
  m.memePosts = other.memePosts ?? 0;
  m.communitiesTalkedIn = other.communitiesTalkedIn ?? 0;
  m.questionsAsked = other.questionsAsked ?? 0;
  m.alphaLeaks = m.bestTradePct >= 500 && other.tradeCardPosts > 0 ? 1 : 0;
  m.legendInMind = other.equippedRarity === 'mythic' && m.winningSells < 10 ? 1 : 0;
  const start = other.kambyStartAt?.getTime();
  m.grandfather = start !== undefined && other.createdAt.getTime() - start <= 7 * DAY && (other.activeMonths ?? 0) >= 6 ? 1 : 0;

  // Easter eggs.
  m.palindrome = trades.length >= 131 || votes.length >= 434 ? 1 : 0;
  m.preLaunchVisit = other.createdAt.getTime() < LAUNCH_AT ? 1 : 0;
  m.betaJoined = other.createdAt.getTime() < LAUNCH_AT && trades.some((t) => t.at.getTime() < LAUNCH_AT) ? 1 : 0;
  void now;
}
