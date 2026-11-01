/**
 * Achievements & titles (2026-11-01, owner: "250 titles, no XP, conditions as in the spec").
 *
 * The catalog lives here in code, not as seeded rows: it's versioned, typed and shared by the API
 * (evaluation) and the web (cards, badges). The database keeps only each user's progress
 * (UserAchievement) and the titles they wear (User.equippedTitleId / showcaseTitleIds).
 *
 * Every title is one metric reaching one target — the metrics are counted from the user's real
 * history (trades, P&L, votes, posts, streams…), so nothing here can be claimed by hand. Titles
 * carry no points, no XP and no prizes: they're only something to show.
 *
 * 2026-11-01 later: the owner added 50 more (5 new categories) — 300 in all.
 *
 * Names and descriptions are English on purpose (badges, like game achievements); the UI around
 * them is translated.
 */

export const ACHIEVEMENT_CATEGORIES = ['beginner', 'personality', 'advanced', 'elite', 'mythic', 'humorous', 'nocturnal', 'brain', 'chaos', 'flex', 'easter'] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export const ACHIEVEMENT_RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type AchievementRarity = (typeof ACHIEVEMENT_RARITIES)[number];

/** Everything a title can be earned by. All counted from real rows — see AchievementsService. */
export const ACHIEVEMENT_METRICS = [
  // Trading
  'trades', 'buys', 'sells', 'volumeUsd', 'coinsTraded', 'chainsUsed', 'winningSells', 'realizedProfitUsd',
  'bestTradePct', 'bestTradeUsd', 'winStreak', 'tradingDays', 'maxTradesInDay', 'maxBuyUsd',
  'solanaTrades', 'baseTrades', 'bnbTrades', 'robinhoodTrades',
  'nightTrades', 'quickFlips', 'diamondHands', 'longHolds', 'panicSells', 'lossSells', 'worstTradeLossPct',
  'rebuys', 'instantFlips', 'breakevenSells',
  'trades420', 'witchingTrades', 'newYearTrades', 'friday13Trades', 'halloweenTrades', 'christmasTrades', 'leapDayTrades',
  // Predictions
  'predictionVotes', 'predictionsCorrect', 'predictionsWrong', 'correctStreak', 'predictionAccuracy', 'pollsCreated',
  // Social
  'posts', 'likesReceived', 'maxPostLikes', 'replies', 'likesGiven', 'pulseMessages', 'dmMessages', 'tradeCardPosts',
  'follows', 'watchlist', 'theses', 'referrals',
  // Live, duels, LaunchPad
  'liveStreams', 'peakViewers', 'liveHours', 'duelsPlayed', 'duelsWon', 'launches',
  // Loyalty & meta
  'longestStreakDays', 'accountAgeDays', 'earlyAdopter', 'profileComplete', 'titlesUnlocked',
  // The owner's 50 (2026-11-01) — Nocturnal & Degenerate
  'lossAfterMidnight', 'wipeouts', 'earlyBirdStreak', 'maxLossHoldHours', 'rugSurvivals', 'hopiumStreak', 'fakeBottoms', 'zeroToHero', 'failedTrades', 'sessionHours',
  // Brain & Sentiment
  'moodSwings', 'doomStreak', 'echoVotes', 'antiSocialTrades', 'chartHours', 'quantumFlips', 'silentWhaleVolume', 'memeAlchemy', 'galaxyBrain', 'shadowSells',
  // Speed & Chaos
  'speedrunZero', 'messagesInHour', 'snipeMisses', 'apeBuys', 'doubleAgent', 'tradesIn2Min', 'chaoticNeutral', 'chartClicks', 'ghostOrders', 'athBuys',
  // Community & Flex
  'reactionsReceived', 'laughsReceived', 'communityTop3', 'lurkerDays', 'memePosts', 'grandfather', 'alphaLeaks', 'communitiesTalkedIn', 'questionsAsked', 'legendInMind',
  // Easter eggs
  'nightTrades0420', 'lucky777', 'palindrome', 'matrixGlitch', 'friday13Wins', 'preLaunchVisit', 'errorReloads', 'paperHandsSupreme', 'feedbackClicks', 'betaJoined',
] as const;

/** Counted by the app itself (the server can't see clicks or screen time) — reported by the
 *  browser through POST /achievements/event, so they're the only titles that could be faked. */
export const CLIENT_ACHIEVEMENT_EVENTS = ['session', 'chart', 'chartClick', 'matrix', 'errorReload', 'feedback'] as const;
export type ClientAchievementEvent = (typeof CLIENT_ACHIEVEMENT_EVENTS)[number];
export type AchievementMetric = (typeof ACHIEVEMENT_METRICS)[number];
export type AchievementMetrics = Record<AchievementMetric, number>;

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: AchievementCategory;
  rarity: AchievementRarity;
  metric: AchievementMetric;
  target: number;
  /** Hidden until unlocked: the card shows "???" and no target. */
  secret: boolean;
  /** What the target counts, for the progress line ("75 / 100 trades"). */
  unit: string;
  /** The target is US dollars — progress reads "$45K / $100K". */
  usd: boolean;
}

type Kind = 'core' | 'personality' | 'humorous';
type R = 'c' | 'r' | 'e' | 'l' | 'm';
const RARITY: Record<R, AchievementRarity> = { c: 'common', r: 'rare', e: 'epic', l: 'legendary', m: 'mythic' };

function categoryOf(kind: Kind, rarity: AchievementRarity): AchievementCategory {
  if (kind === 'humorous') return 'humorous';
  if (rarity === 'mythic') return 'mythic';
  if (rarity === 'legendary') return 'elite';
  if (rarity === 'epic') return 'advanced';
  if (kind === 'personality') return 'personality';
  return rarity === 'common' ? 'beginner' : 'advanced';
}

function compact(n: number, usd: boolean): string {
  const v = n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${+(n / 1_000).toFixed(1)}K` : n.toLocaleString('en-US');
  return usd ? `$${v}` : v;
}

interface Ladder {
  metric: AchievementMetric;
  kind: Kind;
  /** Puts every tier in this category (the owner's 50 come in their own categories). */
  category?: AchievementCategory;
  unit: string;
  usd?: boolean;
  /** Every tier of this ladder is secret (most humorous ones are). */
  secret?: boolean;
  describe: (target: string, n: number) => string;
  tiers: [number, string, R][];
}

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);

const LADDERS: Ladder[] = [
  // ------------------------------------------------------------------ Trading
  {
    metric: 'trades', kind: 'core', unit: 'trades',
    describe: (t, n) => `Complete ${t} ${s(n, 'trade', 'trades')}.`,
    tiers: [[1, 'First Blood', 'c'], [5, 'Warming Up', 'c'], [10, 'Getting the Hang', 'c'], [25, 'Regular', 'c'], [50, 'Committed', 'r'], [100, 'Centurion', 'r'], [250, 'Grinder', 'r'], [500, 'Machine', 'e'], [1000, 'Thousand Club', 'e'], [2500, 'Market Maker', 'l'], [5000, 'Terminal Legend', 'l'], [10000, 'The Algorithm', 'm']],
  },
  {
    metric: 'buys', kind: 'core', unit: 'buys',
    describe: (t, n) => `Buy ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Shopper', 'c'], [10, 'Cart Filler', 'c'], [50, 'Accumulator', 'r'], [200, 'Bag Collector', 'e'], [1000, 'Black Hole', 'l']],
  },
  {
    metric: 'sells', kind: 'core', unit: 'sells',
    describe: (t, n) => `Sell ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Cashing Out', 'c'], [10, 'Profit Taker', 'c'], [50, 'Exit Artist', 'r'], [200, 'Seller of Tops', 'e'], [1000, 'Liquidity Fountain', 'l']],
  },
  {
    metric: 'volumeUsd', kind: 'core', unit: 'volume', usd: true,
    describe: (t) => `Trade ${t} in total volume.`,
    tiers: [[10, 'Pocket Change', 'c'], [100, 'Small Fry', 'c'], [500, 'Minnow', 'c'], [1000, 'Fish', 'r'], [5000, 'Dolphin', 'r'], [10000, 'Barracuda', 'r'], [25000, 'Shark', 'e'], [50000, 'Orca', 'e'], [100000, 'Whale', 'l'], [250000, 'Humpback', 'l'], [500000, 'Blue Whale', 'l'], [1000000, 'Leviathan', 'm'], [5000000, 'Kraken', 'm']],
  },
  {
    metric: 'coinsTraded', kind: 'personality', unit: 'coins',
    describe: (t) => `Trade ${t} different coins.`,
    tiers: [[3, 'Curious', 'c'], [10, 'Explorer', 'c'], [25, 'Coin Hopper', 'r'], [50, 'Degen Tourist', 'r'], [100, 'Collector', 'e'], [250, 'Every Ticker', 'l']],
  },
  {
    metric: 'chainsUsed', kind: 'personality', unit: 'chains',
    describe: (t) => `Trade on ${t} different chains.`,
    tiers: [[2, 'Bridge Walker', 'c'], [3, 'Chain Hopper', 'r'], [4, 'Omnichain', 'e']],
  },
  {
    metric: 'winningSells', kind: 'core', unit: 'winning sells',
    describe: (t, n) => `Close ${t} ${s(n, 'trade', 'trades')} in profit.`,
    tiers: [[1, 'Green Candle', 'c'], [5, 'In the Green', 'c'], [10, 'Winner', 'r'], [25, 'Sharp', 'r'], [50, 'Sniper', 'e'], [100, 'Hitman', 'e'], [250, 'Money Printer', 'l'], [500, 'Midas', 'm']],
  },
  {
    metric: 'realizedProfitUsd', kind: 'core', unit: 'profit', usd: true,
    describe: (t) => `Make ${t} in total realized profit.`,
    tiers: [[1, 'First Dollar', 'c'], [10, 'Lunch Money', 'c'], [50, 'Side Hustle', 'r'], [100, 'Three Digits', 'r'], [500, 'Rent Paid', 'e'], [1000, 'Four Figures', 'e'], [5000, 'Quit My Job (Not Advice)', 'l'], [10000, 'Five Figures', 'l'], [50000, 'Generational', 'm'], [100000, 'Six Figures', 'm']],
  },
  {
    metric: 'bestTradePct', kind: 'core', unit: '% on one trade',
    describe: (t) => `Close a single trade at +${t}%.`,
    tiers: [[25, 'Nice Pop', 'c'], [50, 'Half Up', 'r'], [100, 'Doubler', 'r'], [200, 'Triple Threat', 'e'], [500, 'Moon Mission', 'e'], [1000, 'Ten Bagger', 'l'], [9900, 'Hundred Bagger', 'm']],
  },
  {
    metric: 'bestTradeUsd', kind: 'core', unit: 'on one trade', usd: true,
    describe: (t) => `Make ${t} profit on a single trade.`,
    tiers: [[10, 'Tip Jar', 'c'], [100, 'Payday', 'r'], [1000, 'Big Score', 'e'], [10000, 'Heist', 'l']],
  },
  {
    metric: 'winStreak', kind: 'core', unit: 'wins in a row',
    describe: (t) => `Close ${t} trades in profit in a row.`,
    tiers: [[3, 'Hat Trick', 'r'], [5, 'On Fire', 'e'], [10, 'Unstoppable', 'l'], [20, 'Can\'t Miss', 'm']],
  },
  {
    metric: 'tradingDays', kind: 'personality', unit: 'days',
    describe: (t) => `Trade on ${t} different days.`,
    tiers: [[3, 'Back Again', 'c'], [7, 'Week One', 'c'], [30, 'Habit', 'r'], [100, 'Lifer', 'e'], [365, 'Every Day Is Market Day', 'l']],
  },
  {
    metric: 'maxTradesInDay', kind: 'personality', unit: 'trades in one day',
    describe: (t) => `Make ${t} trades in a single day.`,
    tiers: [[10, 'Busy Day', 'c'], [25, 'Caffeinated', 'r'], [50, 'Speed Demon', 'e'], [100, 'No Sleep Mode', 'l']],
  },
  {
    metric: 'maxBuyUsd', kind: 'core', unit: 'in one buy', usd: true,
    describe: (t) => `Place a single buy of ${t} or more.`,
    tiers: [[100, 'Big Ticket', 'r'], [1000, 'High Roller', 'e'], [10000, 'Market Mover', 'l']],
  },
  {
    metric: 'solanaTrades', kind: 'personality', unit: 'trades on Solana',
    describe: (t, n) => `Make ${t} ${s(n, 'trade', 'trades')} on Solana.`,
    tiers: [[1, 'Sol Curious', 'c'], [25, 'Solana Native', 'r'], [100, 'Solana Maxi', 'e']],
  },
  {
    metric: 'baseTrades', kind: 'personality', unit: 'trades on Base',
    describe: (t, n) => `Make ${t} ${s(n, 'trade', 'trades')} on Base.`,
    tiers: [[1, 'Based', 'c'], [25, 'Base Builder', 'r'], [100, 'Base Maxi', 'e']],
  },
  {
    metric: 'bnbTrades', kind: 'personality', unit: 'trades on BNB Chain',
    describe: (t, n) => `Make ${t} ${s(n, 'trade', 'trades')} on BNB Chain.`,
    tiers: [[1, 'Yellow Pill', 'c'], [25, 'BNB Regular', 'r'], [100, 'BNB Maxi', 'e']],
  },
  {
    metric: 'robinhoodTrades', kind: 'personality', unit: 'trades on Robinhood Chain',
    describe: (t, n) => `Make ${t} ${s(n, 'trade', 'trades')} on Robinhood Chain.`,
    tiers: [[1, 'Merry Man', 'c'], [25, 'Sherwood Regular', 'r'], [100, 'Prince of Thieves', 'e']],
  },
  {
    metric: 'nightTrades', kind: 'personality', unit: 'night trades',
    describe: (t, n) => `Make ${t} ${s(n, 'trade', 'trades')} between midnight and 5 AM (UTC).`,
    tiers: [[1, 'Night Owl', 'c'], [10, 'Insomniac', 'r'], [50, 'Vampire', 'e'], [200, 'Creature of the Night', 'l']],
  },
  {
    metric: 'quickFlips', kind: 'personality', unit: 'quick flips',
    describe: (t, n) => `Sell in profit within 5 minutes of buying, ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Flipper', 'r'], [10, 'Scalper', 'e'], [50, 'Flash', 'l']],
  },
  {
    metric: 'diamondHands', kind: 'personality', unit: 'long winners',
    describe: (t, n) => `Hold a coin 30+ days, then sell in profit — ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Diamond Hands', 'e'], [5, 'Unshakeable', 'l']],
  },
  {
    metric: 'longHolds', kind: 'personality', unit: 'holds of 90+ days',
    describe: () => 'Hold a coin for 90 days before selling.',
    tiers: [[1, 'Time Traveler', 'l']],
  },
  {
    metric: 'panicSells', kind: 'humorous', unit: 'panic sells', secret: true,
    describe: (t, n) => `Sell at a loss within 10 minutes of buying, ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Paper Hands', 'c'], [10, 'Tissue Paper', 'r']],
  },
  {
    metric: 'lossSells', kind: 'humorous', unit: 'losing trades',
    describe: (t, n) => `Close ${t} ${s(n, 'trade', 'trades')} at a loss. It happens.`,
    tiers: [[1, 'Tuition Paid', 'c'], [10, 'Expensive Lessons', 'r'], [50, 'PhD in Pain', 'e']],
  },
  {
    metric: 'worstTradeLossPct', kind: 'humorous', unit: '% lost on one trade', secret: true,
    describe: (t) => `Close a single trade down ${t}% or more.`,
    tiers: [[50, 'Half Gone', 'r'], [90, 'Down Bad', 'e']],
  },
  {
    metric: 'rebuys', kind: 'humorous', unit: 'rebuys',
    describe: (t, n) => `Buy back a coin you already sold, ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'Boomerang', 'c'], [10, 'Can\'t Quit You', 'r']],
  },
  {
    metric: 'instantFlips', kind: 'humorous', unit: 'one-minute round trips', secret: true,
    describe: () => 'Buy and sell the same coin within 60 seconds.',
    tiers: [[1, 'Speedrun', 'e']],
  },
  {
    metric: 'breakevenSells', kind: 'humorous', unit: 'break-even sells', secret: true,
    describe: () => 'Sell a position within one cent of what you paid.',
    tiers: [[1, 'Perfectly Balanced', 'e']],
  },
  {
    metric: 'trades420', kind: 'humorous', unit: 'trades at 4:20', secret: true,
    describe: () => 'Make a trade at exactly 4:20 (UTC).',
    tiers: [[1, 'Four Twenty', 'r']],
  },
  {
    metric: 'witchingTrades', kind: 'humorous', unit: 'trades at 3 AM', secret: true,
    describe: () => 'Make a trade between 3 and 4 AM (UTC).',
    tiers: [[1, 'Witching Hour', 'r']],
  },
  {
    metric: 'newYearTrades', kind: 'humorous', unit: 'New Year trades', secret: true,
    describe: () => 'Make a trade in the first hour of New Year\'s Day (UTC).',
    tiers: [[1, 'Happy New Bags', 'l']],
  },
  {
    metric: 'friday13Trades', kind: 'humorous', unit: 'Friday the 13th trades', secret: true,
    describe: () => 'Make a trade on a Friday the 13th.',
    tiers: [[1, 'Bad Omen', 'e']],
  },
  {
    metric: 'halloweenTrades', kind: 'humorous', unit: 'Halloween trades', secret: true,
    describe: () => 'Make a trade on Halloween.',
    tiers: [[1, 'Spooky Bags', 'r']],
  },
  {
    metric: 'christmasTrades', kind: 'humorous', unit: 'Christmas trades', secret: true,
    describe: () => 'Make a trade on Christmas Day.',
    tiers: [[1, 'Santa\'s Degen', 'r']],
  },
  {
    metric: 'leapDayTrades', kind: 'humorous', unit: 'leap day trades', secret: true,
    describe: () => 'Make a trade on February 29th.',
    tiers: [[1, 'Leap of Faith', 'm']],
  },

  // ------------------------------------------------------------------ Predictions
  {
    metric: 'predictionVotes', kind: 'core', unit: 'votes',
    describe: (t, n) => `Vote on ${t} ${s(n, 'prediction', 'predictions')}.`,
    tiers: [[1, 'Fortune Teller', 'c'], [10, 'Hunch Haver', 'c'], [50, 'Forecaster', 'r'], [100, 'Pundit', 'r'], [250, 'Analyst', 'e'], [500, 'Prophet in Training', 'e'], [1000, 'Voice of the Crowd', 'l']],
  },
  {
    metric: 'predictionsCorrect', kind: 'core', unit: 'correct calls',
    describe: (t, n) => `Get ${t} ${s(n, 'prediction', 'predictions')} right.`,
    tiers: [[1, 'Called It', 'c'], [10, 'Good Instincts', 'r'], [50, 'Seer', 'e'], [100, 'Oracle', 'e'], [250, 'Nostradamus', 'l'], [500, 'Time Lord', 'm']],
  },
  {
    metric: 'correctStreak', kind: 'core', unit: 'right in a row',
    describe: (t) => `Get ${t} predictions right in a row.`,
    tiers: [[3, 'Hot Hand', 'r'], [5, 'Crystal Ball', 'e'], [10, 'Clairvoyant', 'l'], [15, 'Future Seer', 'l'], [25, 'The Prophecy', 'm']],
  },
  {
    metric: 'predictionAccuracy', kind: 'core', unit: '% accuracy (20+ calls)',
    describe: (t) => `Hold ${t}% accuracy over at least 20 decided predictions.`,
    tiers: [[60, 'Better Than a Coin Flip', 'r'], [70, 'Sharp Eye', 'e'], [80, 'Mind Reader', 'l']],
  },
  {
    metric: 'predictionsWrong', kind: 'humorous', unit: 'wrong calls',
    describe: (t) => `Get ${t} predictions wrong. Inverse you and profit.`,
    tiers: [[10, 'Inverse Indicator', 'c'], [50, 'Professional Fader', 'r']],
  },
  {
    metric: 'pollsCreated', kind: 'personality', unit: 'polls',
    describe: (t, n) => `Ask ${t} ${s(n, 'prediction', 'predictions')} of your own.`,
    tiers: [[1, 'Question Master', 'c'], [10, 'Poll Dancer', 'r']],
  },

  // ------------------------------------------------------------------ Social
  {
    metric: 'posts', kind: 'personality', unit: 'posts',
    describe: (t, n) => `Publish ${t} ${s(n, 'post', 'posts')} on the Feed.`,
    tiers: [[1, 'Hello World', 'c'], [10, 'Poster', 'c'], [50, 'Shitposter', 'r'], [100, 'Columnist', 'r'], [500, 'Influencer', 'e'], [1000, 'Media Empire', 'l']],
  },
  {
    metric: 'likesReceived', kind: 'core', unit: 'likes received',
    describe: (t, n) => `Get ${t} ${s(n, 'like', 'likes')} on your posts.`,
    tiers: [[1, 'Noticed', 'c'], [10, 'Liked', 'c'], [50, 'Popular', 'r'], [100, 'Crowd Favorite', 'r'], [500, 'Fan Club', 'e'], [1000, 'Celebrity', 'e'], [5000, 'Icon', 'l'], [10000, 'Living Meme', 'm']],
  },
  {
    metric: 'maxPostLikes', kind: 'core', unit: 'likes on one post',
    describe: (t) => `Get ${t} likes on a single post.`,
    tiers: [[10, 'Hit', 'c'], [50, 'Banger', 'r'], [100, 'Viral', 'e'], [500, 'Front Page', 'l']],
  },
  {
    metric: 'replies', kind: 'personality', unit: 'replies',
    describe: (t, n) => `Write ${t} ${s(n, 'reply', 'replies')}.`,
    tiers: [[1, 'Conversationalist', 'c'], [10, 'Chatty', 'c'], [50, 'Reply Guy', 'r'], [200, 'Debate Club', 'e'], [1000, 'Comment Section King', 'l']],
  },
  {
    metric: 'likesGiven', kind: 'personality', unit: 'likes given',
    describe: (t) => `Like ${t} posts.`,
    tiers: [[10, 'Supportive', 'c'], [100, 'Hype Man', 'r'], [1000, 'Cheerleader', 'e']],
  },
  {
    metric: 'pulseMessages', kind: 'personality', unit: 'chat messages',
    describe: (t, n) => `Send ${t} ${s(n, 'message', 'messages')} in Pulse or coin chats.`,
    tiers: [[1, 'First Words', 'c'], [50, 'Regular Voice', 'c'], [500, 'Chat Fixture', 'r'], [2000, 'Town Crier', 'e']],
  },
  {
    metric: 'dmMessages', kind: 'personality', unit: 'messages',
    describe: (t, n) => `Send ${t} private ${s(n, 'message', 'messages')}.`,
    tiers: [[1, 'Slid In', 'c'], [100, 'Pen Pal', 'c'], [1000, 'Group Chat Hero', 'r'], [10000, 'Never Offline', 'e']],
  },
  {
    metric: 'tradeCardPosts', kind: 'personality', unit: 'trade & PnL cards',
    describe: (t, n) => `Post ${t} Trade or PnL ${s(n, 'card', 'cards')}.`,
    tiers: [[1, 'Receipts', 'c'], [10, 'Show Don\'t Tell', 'r'], [50, 'Proof of Work', 'e']],
  },
  {
    metric: 'follows', kind: 'personality', unit: 'traders followed',
    describe: (t, n) => `Follow ${t} ${s(n, 'trader', 'traders')}.`,
    tiers: [[1, 'Follower', 'c'], [10, 'Networker', 'c'], [50, 'Talent Scout', 'r']],
  },
  {
    metric: 'watchlist', kind: 'personality', unit: 'coins watched',
    describe: (t, n) => `Add ${t} ${s(n, 'coin', 'coins')} to your watchlist.`,
    tiers: [[1, 'Watcher', 'c'], [10, 'Radar On', 'c'], [50, 'Hawk Eye', 'r']],
  },
  {
    metric: 'theses', kind: 'personality', unit: 'theses',
    describe: (t, n) => `Write ${t} ${s(n, 'thesis', 'theses')} on coins you hold.`,
    tiers: [[1, 'Thinker', 'c'], [10, 'Researcher', 'r']],
  },
  {
    metric: 'referrals', kind: 'core', unit: 'friends invited',
    describe: (t, n) => `Invite ${t} ${s(n, 'friend', 'friends')} who join Kamby.`,
    tiers: [[1, 'Plus One', 'c'], [5, 'Recruiter', 'r'], [10, 'Squad Builder', 'e'], [25, 'Ambassador', 'l'], [100, 'Founding Father', 'm']],
  },

  // ------------------------------------------------------------------ Live, duels, LaunchPad
  {
    metric: 'liveStreams', kind: 'personality', unit: 'streams',
    describe: (t, n) => `Go live ${t} ${s(n, 'time', 'times')}.`,
    tiers: [[1, 'On Air', 'c'], [10, 'Streamer', 'r'], [50, 'Broadcaster', 'e'], [100, 'Network', 'l']],
  },
  {
    metric: 'peakViewers', kind: 'core', unit: 'viewers at once',
    describe: (t) => `Have ${t} people watching your stream at once.`,
    tiers: [[10, 'Small Crowd', 'c'], [50, 'Packed Room', 'r'], [100, 'Main Stage', 'e'], [500, 'Arena', 'l'], [1000, 'Stadium', 'm']],
  },
  {
    metric: 'liveHours', kind: 'personality', unit: 'hours live',
    describe: (t, n) => `Stream for ${t} ${s(n, 'hour', 'hours')} in total.`,
    tiers: [[1, 'Pilot Episode', 'c'], [10, 'Season One', 'r'], [50, 'Marathoner', 'e'], [100, '24/7', 'l']],
  },
  {
    metric: 'duelsPlayed', kind: 'personality', unit: 'duels',
    describe: (t, n) => `Finish ${t} ${s(n, 'duel', 'duels')}.`,
    tiers: [[1, 'Challenger', 'c'], [10, 'Duelist', 'r'], [50, 'Gladiator', 'e']],
  },
  {
    metric: 'duelsWon', kind: 'core', unit: 'duels won',
    describe: (t, n) => `Win ${t} ${s(n, 'duel', 'duels')}.`,
    tiers: [[1, 'Victor', 'c'], [5, 'Champion', 'r'], [25, 'Warlord', 'e'], [100, 'Undefeated Legend', 'l']],
  },
  {
    metric: 'launches', kind: 'core', unit: 'coins launched',
    describe: (t, n) => `Launch ${t} ${s(n, 'coin', 'coins')} on LaunchPad.`,
    tiers: [[1, 'Founder', 'r'], [3, 'Serial Founder', 'e'], [10, 'Coin Factory', 'l'], [25, 'Mint Machine', 'm']],
  },

  // ------------------------------------------------------------------ Loyalty & meta
  {
    metric: 'longestStreakDays', kind: 'core', unit: 'days in a row',
    describe: (t) => `Open Kamby ${t} days in a row.`,
    tiers: [[3, 'Hooked', 'c'], [7, 'Weekly Ritual', 'c'], [14, 'Two Weeks Strong', 'r'], [30, 'Monthly Regular', 'r'], [60, 'Devoted', 'e'], [100, 'Triple Digits', 'e'], [200, 'Unbreakable', 'l'], [365, 'Year of Kamby', 'm']],
  },
  {
    metric: 'accountAgeDays', kind: 'core', unit: 'days on Kamby',
    describe: (t) => `Be on Kamby for ${t} days.`,
    tiers: [[7, 'Newcomer', 'c'], [30, 'Settled In', 'c'], [90, 'Veteran', 'r'], [180, 'Old Hand', 'e'], [365, 'One Year Strong', 'l'], [730, 'OG', 'm']],
  },
  {
    metric: 'earlyAdopter', kind: 'core', unit: 'early account',
    describe: () => 'Join Kamby before 2027.',
    tiers: [[1, 'Day One', 'm']],
  },
  {
    metric: 'profileComplete', kind: 'core', unit: 'profile',
    describe: () => 'Pick a username and a profile picture.',
    tiers: [[2, 'Face to the Name', 'c']],
  },
  {
    metric: 'titlesUnlocked', kind: 'core', unit: 'titles',
    describe: (t) => `Unlock ${t} other titles.`,
    tiers: [[10, 'Badge Hunter', 'c'], [25, 'Trophy Case', 'r'], [50, 'Completionist in Training', 'e'], [100, 'Hall of Fame', 'l'], [150, 'Living Legend', 'l'], [200, 'Kamby Immortal', 'm']],
  },

  // ------------------------------------------------------------------ The owner's 50 (2026-11-01)
  // Each is one real, countable condition — where the idea needs data Kamby doesn't keep (perps
  // liquidations, gas, balance history, who bought first), the description says exactly what counts.
  { metric: 'lossAfterMidnight', kind: 'humorous', category: 'nocturnal', unit: "midnight bags", describe: () => "Hold a losing position past midnight (UTC), then sell it.", tiers: [[1, "Wife's Boyfriend", 'r']] },
  { metric: 'wipeouts', kind: 'humorous', category: 'nocturnal', unit: "wipeouts", describe: () => "Close a trade down 99% or more — fully wiped.", tiers: [[1, "Liquidated & Lovin' It", 'r']] },
  { metric: 'earlyBirdStreak', kind: 'humorous', category: 'nocturnal', unit: "early days in a row", describe: () => "Trade before 6 AM (UTC) on 5 days in a row.", tiers: [[5, "Coffee IV", 'e']] },
  { metric: 'maxLossHoldHours', kind: 'humorous', category: 'nocturnal', unit: "hours in the red", describe: () => "Sit through 10+ hours in the red on a position before selling.", tiers: [[10, "Red Candle Connoisseur", 'r']] },
  { metric: 'rugSurvivals', kind: 'humorous', category: 'nocturnal', unit: "rugs survived", describe: () => "Get out of a coin down 90%+ within a day of buying it.", tiers: [[1, "The Rug Pull Survivor", 'e']] },
  { metric: 'hopiumStreak', kind: 'humorous', category: 'nocturnal', unit: "wrong bullish calls in a row", describe: () => "Vote bullish 5 times in a row and be wrong every time.", tiers: [[5, "Hopium Overdose", 'r']] },
  { metric: 'fakeBottoms', kind: 'humorous', category: 'nocturnal', unit: "fake bottoms", describe: () => "Buy back a coin you sold at a loss — and lose 50%+ again.", tiers: [[1, "Bottom Finder (Fake)", 'r']] },
  { metric: 'zeroToHero', kind: 'humorous', category: 'nocturnal', unit: "trades", describe: () => "Turn under $1 into over $100 on a single trade.", tiers: [[1, "Zero to Hero", 'l']] },
  { metric: 'failedTrades', kind: 'humorous', category: 'nocturnal', unit: "failed trades", describe: () => "Have 50 trades fail on-chain. Kamby pays the gas, so it only cost you nerves.", tiers: [[50, "Gas Fee Victim", 'r']] },
  { metric: 'sessionHours', kind: 'humorous', category: 'nocturnal', unit: "hours straight", describe: () => "Keep Kamby open and active for 12 hours straight.", tiers: [[12, "The Terminal Rat", 'e']] },
  { metric: 'moodSwings', kind: 'humorous', category: 'brain', unit: "flips", describe: () => "Flip between buying and selling the same coin 3 times in 10 minutes.", tiers: [[1, "Bipolar Trader", 'r']] },
  { metric: 'doomStreak', kind: 'humorous', category: 'brain', unit: "correct bearish calls in a row", describe: () => "Call 5 drops in a row correctly (down / below / red answers).", tiers: [[5, "The Prophet of Doom", 'l']] },
  { metric: 'echoVotes', kind: 'humorous', category: 'brain', unit: "majority votes", describe: () => "Vote with an 80%+ majority on 20 predictions.", tiers: [[20, "Echo Chamber Resident", 'r']] },
  { metric: 'antiSocialTrades', kind: 'humorous', category: 'brain', unit: "silent trades", describe: () => "Make 100 trades without writing a single post, reply or message.", tiers: [[100, "The Anti-Social", 'e']] },
  { metric: 'chartHours', kind: 'humorous', category: 'brain', unit: "hours on one chart", describe: () => "Spend 500 hours on one coin's chart.", tiers: [[500, "Chart Stalker", 'm']] },
  { metric: 'quantumFlips', kind: 'humorous', category: 'brain', unit: "quantum flips", describe: () => "Buy and sell the same coin within 3 seconds.", tiers: [[1, "Quantum Degen", 'e']] },
  { metric: 'silentWhaleVolume', kind: 'humorous', category: 'brain', unit: "silent volume", usd: true, describe: () => "Trade $10K+ in volume with zero followers and zero posts.", tiers: [[10000, "The Silent Whale", 'l']] },
  { metric: 'memeAlchemy', kind: 'humorous', category: 'brain', unit: "charts with 50+ likes", describe: () => "Post 10 charts that each get 50+ likes.", tiers: [[10, "Meme Alchemist", 'l']] },
  { metric: 'galaxyBrain', kind: 'humorous', category: 'brain', unit: "contrarian wins", describe: () => "Be right 10 times while 90%+ of voters picked the other side.", tiers: [[10, "Galaxy Brain", 'm']] },
  { metric: 'shadowSells', kind: 'humorous', category: 'brain', unit: "sells before a pump", describe: () => "Sell a coin, then watch it trade 20%+ higher on Kamby within 10 minutes.", tiers: [[1, "The Liquidator's Shadow", 'e']] },
  { metric: 'speedrunZero', kind: 'humorous', category: 'chaos', unit: "speedruns", describe: () => "Lose 95%+ on a position in under 5 minutes.", tiers: [[1, "Speedrun to Zero", 'r']] },
  { metric: 'messagesInHour', kind: 'humorous', category: 'chaos', unit: "messages in an hour", describe: () => "Send 200 messages within one hour.", tiers: [[200, "Keyboard Destroyer", 'e']] },
  { metric: 'snipeMisses', kind: 'humorous', category: 'chaos', unit: "missed snipes", describe: () => "Have a buy fail, then land the same coin within a minute.", tiers: [[1, "The Sniper's Miss", 'r']] },
  { metric: 'apeBuys', kind: 'humorous', category: 'chaos', unit: "early apes", describe: () => "Buy 10 Pump.fun coins within 10 minutes of their launch.", tiers: [[10, "Ape King", 'l']] },
  { metric: 'doubleAgent', kind: 'humorous', category: 'chaos', unit: "double votes", describe: () => "Pick opposite answers on two polls about the same coin that were open at the same time.", tiers: [[1, "Double Agent", 'r']] },
  { metric: 'tradesIn2Min', kind: 'humorous', category: 'chaos', unit: "trades in 2 minutes", describe: () => "Make 20 trades within 2 minutes.", tiers: [[20, "The Fast and the Rekt", 'e']] },
  { metric: 'chaoticNeutral', kind: 'humorous', category: 'chaos', unit: "perfect balance", describe: () => "After your first 100 sells: exactly as many wins as losses.", tiers: [[1, "Chaotic Neutral", 'e']] },
  { metric: 'chartClicks', kind: 'humorous', category: 'chaos', unit: "chart clicks", describe: () => "Switch chart timeframes 1,000 times.", tiers: [[1000, "Button Smash Hero", 'r']] },
  { metric: 'ghostOrders', kind: 'humorous', category: 'chaos', unit: "ghost orders", describe: () => "Try to buy a coin and have the order fail.", tiers: [[1, "The Ghost Order", 'c']] },
  { metric: 'athBuys', kind: 'humorous', category: 'chaos', unit: "tops bought", describe: () => "Pay the highest price anyone on Kamby ever paid for a coin — then see it bought cheaper.", tiers: [[1, "FOMO Intensifies", 'r']] },
  { metric: 'reactionsReceived', kind: 'humorous', category: 'flex', unit: "reactions", describe: () => "Collect 5,000 reactions on your messages.", tiers: [[5000, "Chief Hype Officer", 'l']] },
  { metric: 'laughsReceived', kind: 'humorous', category: 'flex', unit: "laughs", describe: () => "Get 100 😂 reactions on your messages.", tiers: [[100, "The Village Idiot", 'r']] },
  { metric: 'communityTop3', kind: 'humorous', category: 'flex', unit: "communities", describe: () => "Be a top-3 voice (by messages) in a community of 10+ members.", tiers: [[1, "Chad of Kamby", 'l']] },
  { metric: 'lurkerDays', kind: 'humorous', category: 'flex', unit: "silent days", describe: () => "Spend 60 days on Kamby without writing a single word.", tiers: [[60, "The Lurker", 'r']] },
  { metric: 'memePosts', kind: 'humorous', category: 'flex', unit: "memes", describe: () => "Share 50 photos, charts or videos on the Feed.", tiers: [[50, "Meme Lord", 'e']] },
  { metric: 'grandfather', kind: 'humorous', category: 'flex', unit: "legacy", describe: () => "Join in Kamby's first week and stay active across 6 different months.", tiers: [[1, "The Grandfather", 'm']] },
  { metric: 'alphaLeaks', kind: 'humorous', category: 'flex', unit: "leaks", describe: () => "Close a trade at +500% or more after posting a Trade or PnL card.", tiers: [[1, "Alpha Leaker", 'l']] },
  { metric: 'communitiesTalkedIn', kind: 'humorous', category: 'flex', unit: "communities", describe: () => "Talk in 15 different communities.", tiers: [[15, "The Diplomat", 'e']] },
  { metric: 'questionsAsked', kind: 'humorous', category: 'flex', unit: "questions", describe: () => "Ask 50 questions in chats.", tiers: [[50, "Nightmare Moderator", 'r']] },
  { metric: 'legendInMind', kind: 'humorous', category: 'flex', unit: "delusions", describe: () => "Wear a Mythic title with fewer than 10 winning trades.", tiers: [[1, "The Legend in His Own Mind", 'e']] },
  { metric: 'nightTrades0420', kind: 'humorous', category: 'easter', unit: "trades", secret: true, describe: () => "Make a trade at exactly 04:20 at night (UTC).", tiers: [[1, "The 4:20 Trader", 'r']] },
  { metric: 'lucky777', kind: 'humorous', category: 'easter', unit: "lucky trades", secret: true, describe: () => "Make a trade of exactly $7.77.", tiers: [[1, "Lucky 777", 'e']] },
  { metric: 'palindrome', kind: 'humorous', category: 'easter', unit: "palindromes", secret: true, describe: () => "Reach 131 trades or 434 prediction votes.", tiers: [[1, "Palindrome Master", 'r']] },
  { metric: 'matrixGlitch', kind: 'humorous', category: 'easter', unit: "glitches", secret: true, describe: () => "Tap the same spot 50 times in 5 seconds.", tiers: [[1, "The Matrix Glitch", 'r']] },
  { metric: 'friday13Wins', kind: 'humorous', category: 'easter', unit: "wins", secret: true, describe: () => "Close a winning trade on a Friday the 13th.", tiers: [[1, "Friday the 13th", 'e']] },
  { metric: 'preLaunchVisit', kind: 'humorous', category: 'easter', unit: "early visits", secret: true, describe: () => "Have a Kamby account before the official launch (Nov 20, 2026).", tiers: [[1, "The Time Traveler", 'l']] },
  { metric: 'errorReloads', kind: 'humorous', category: 'easter', unit: "reloads", secret: true, describe: () => "Hit an error screen and reload 3 times.", tiers: [[3, "Error 404", 'c']] },
  { metric: 'paperHandsSupreme', kind: 'humorous', category: 'easter', unit: "nervous sells", secret: true, describe: () => "Sell in profit by less than 0.5% — pure fear.", tiers: [[1, "Paper Hands Supreme", 'c']] },
  { metric: 'feedbackClicks', kind: 'humorous', category: 'easter', unit: "feedback", secret: true, describe: () => "Send the Kamby team feedback for the first time.", tiers: [[1, "To the Moon", 'c']] },
  { metric: 'betaJoined', kind: 'humorous', category: 'easter', unit: "beta", secret: true, describe: () => "Join and trade in the closed test round, before Nov 20, 2026.", tiers: [[1, "Kamby OG", 'm']] },
];

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const ACHIEVEMENTS: Achievement[] = LADDERS.flatMap((ladder) =>
  ladder.tiers.map(([target, name, r]) => {
    const rarity = RARITY[r];
    return {
      id: slug(name),
      name,
      description: ladder.describe(compact(target, !!ladder.usd), target),
      category: ladder.category ?? categoryOf(ladder.kind, rarity),
      rarity,
      metric: ladder.metric,
      target,
      // Humorous ladders marked secret, and every mythic title, stay hidden until unlocked.
      secret: !!ladder.secret || rarity === 'mythic',
      unit: ladder.unit,
      usd: !!ladder.usd,
    };
  }),
);

export const ACHIEVEMENTS_BY_ID: ReadonlyMap<string, Achievement> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
export const MAX_SHOWCASE_TITLES = 3;

export function emptyAchievementMetrics(): AchievementMetrics {
  return Object.fromEntries(ACHIEVEMENT_METRICS.map((m) => [m, 0])) as AchievementMetrics;
}

/** Each title's progress for these metrics; `titlesUnlocked` is filled in from the first pass. */
export function evaluateAchievements(metrics: AchievementMetrics): { id: string; progress: number; target: number; unlocked: boolean }[] {
  const first = ACHIEVEMENTS.filter((a) => a.metric !== 'titlesUnlocked' && metrics[a.metric] >= a.target).length;
  const m = { ...metrics, titlesUnlocked: first };
  return ACHIEVEMENTS.map((a) => {
    const progress = Math.max(0, m[a.metric]);
    return { id: a.id, progress, target: a.target, unlocked: progress >= a.target };
  });
}

/** One user's view of a title, as the API returns it. Secret locked ones come without words. */
export interface AchievementProgressDto {
  id: string;
  unlocked: boolean;
  unlockedAt: string | null;
  /** Null for a locked secret title ("??? Progress hidden"). */
  progress: number | null;
  /** Share of traders who have it, 0–100, and how many. */
  unlockedPct: number;
  unlockedCount: number;
}

export interface AchievementsDto {
  achievements: AchievementProgressDto[];
  equippedTitleId: string | null;
  showcaseTitleIds: string[];
  /** Traders the percentages are out of. */
  traders: number;
}
