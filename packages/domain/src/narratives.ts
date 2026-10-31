/**
 * Narratives (2026-10-31): coins grouped by the story the market is trading — AI agents,
 * Solana memes, DeFi… Tags come from a curated list of verified coins plus keywords on a coin's
 * symbol/name (a free, honest heuristic — some coins stay untagged, none get a made-up label).
 * The API scores each narrative's Heat Index from real activity; see heatIndex().
 */

export interface NarrativeSeed {
  chainIdentifier: string;
  tokenAddress: string;
}

export interface NarrativeDef {
  id: string;
  name: string;
  emoji: string;
  /** Matched against a coin's symbol and name. */
  keywords?: RegExp;
  /** Only coins on these chains (keywords and launch rules). */
  chains?: readonly string[];
  /** A launch rule: e.g. Pump.fun mints end in "pump", Four.meme tokens in "4444". */
  addressSuffix?: string;
  /** Verified coins that always belong. */
  seeds?: readonly NarrativeSeed[];
}

const SOL = 'solana';
const BASE = 'eip155:8453';
const BNB = 'eip155:56';

const s = (chainIdentifier: string, tokenAddress: string): NarrativeSeed => ({ chainIdentifier, tokenAddress });

const MEME_WORDS = /(dog|doge|inu|shib|pepe|frog|cat|kitty|meme|moon|chad|wojak|pump|elon|bonk|wif|giga|based|ape|monke|hamster|penguin|fart)/i;

export const NARRATIVES: readonly NarrativeDef[] = [
  {
    id: 'ai-agents',
    name: 'AI Agents',
    emoji: '🤖',
    keywords: /\b(ai|agi|agents?|gpt|llm|bots?|neural|virtuals?|sentient|robot|robo|aixbt|grok|claude|eliza)\b|ai$/i,
    seeds: [
      s(BASE, '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b'), // VIRTUAL
      s(BASE, '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825'), // AIXBT
      s(BASE, '0x22aF33FE49fD1Fa80c7149773dDe5890D3c76F3b'), // BNKR
      s(BASE, '0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf'), // VVV
      s(BASE, '0x3ec2156D4c0A9CBdAB4a016633b7BcF6a8d68Ea2'), // DRB
      s(BASE, '0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb'), // CLANKER
    ],
  },
  {
    id: 'solana-memes',
    name: 'Solana Memes',
    emoji: '🟣',
    chains: [SOL],
    addressSuffix: 'pump',
    keywords: MEME_WORDS,
    seeds: [s(SOL, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), s(SOL, 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm')],
  },
  {
    id: 'base-memes',
    name: 'Base Memes',
    emoji: '🔵',
    chains: [BASE],
    keywords: MEME_WORDS,
    seeds: [
      s(BASE, '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed'), // DEGEN
      s(BASE, '0x532f27101965dd16442E59d40670FaF5eBB142E4'), // BRETT
      s(BASE, '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4'), // TOSHI
      s(BASE, '0x6921B130D297cc43754afba22e5EAc0FBf8Db75b'), // DOGINME
      s(BASE, '0x50dA645f148798F68EF2d7dB7C1CB22A6819bb2C'), // SPX6900
    ],
  },
  {
    id: 'bnb-memes',
    name: 'BNB Memes',
    emoji: '🟡',
    chains: [BNB],
    addressSuffix: '4444',
    keywords: MEME_WORDS,
  },
  {
    id: 'dogs',
    name: 'Dog Coins',
    emoji: '🐶',
    keywords: /(dog|doge|inu|shib|wif|bonk|puppy|pup|shiba|doggo)/i,
    seeds: [s(SOL, 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'), s(SOL, 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm'), s(BASE, '0x6921B130D297cc43754afba22e5EAc0FBf8Db75b')],
  },
  {
    id: 'cats',
    name: 'Cat Coins',
    emoji: '🐱',
    keywords: /(cat|kitty|kitten|meow|neko|mew|purr|toshi)/i,
    seeds: [s(BASE, '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4')],
  },
  {
    id: 'frogs',
    name: 'Pepe & Frogs',
    emoji: '🐸',
    keywords: /(pepe|frog|toad|brett|kek|ribbit)/i,
    seeds: [s(BASE, '0x532f27101965dd16442E59d40670FaF5eBB142E4')],
  },
  {
    id: 'defi',
    name: 'DeFi',
    emoji: '🏦',
    keywords: /\b(swap|dex|finance|lend|lending|yield|stake|staking|perps?|vault|amm|liquid)\b/i,
    seeds: [
      s(SOL, 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'), // JUP
      s(SOL, '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R'), // RAY
      s(SOL, 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL'), // JTO
      s(SOL, 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3'), // PYTH
      s(BASE, '0x63706e401c06ac8513145b7687A14804d17f814b'), // AAVE
      s(BASE, '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842'), // MORPHO
      s(BASE, '0xc3De830EA07524a0761646a6a4e4be0e114a3C83'), // UNI
      s(BASE, '0x940181a94A35A4569E4529A3CDfB74e38FD98631'), // AERO
      s(BNB, '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82'), // CAKE
    ],
  },
  {
    id: 'social',
    name: 'SocialFi & Creators',
    emoji: '🎙️',
    keywords: /\b(social|creators?|fans?|zora|farcaster|friend|stream|tiktok)\b/i,
    seeds: [s(BASE, '0x1111111111166b7FE7bd91427724B487980aFc69'), s(BASE, '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed')], // ZORA, DEGEN
  },
  {
    id: 'privacy',
    name: 'Privacy',
    emoji: '🕶️',
    keywords: /\b(privacy|private|zk|zero.?knowledge|anon|anonymous|stealth|monero|zcash|mixer)\b/i,
  },
  {
    id: 'desci',
    name: 'DeSci',
    emoji: '🧬',
    keywords: /\b(desci|science|bio|research|longevity|genes?|lab)\b/i,
  },
  {
    id: 'gaming',
    name: 'Gaming',
    emoji: '🎮',
    keywords: /\b(game|gaming|play|arcade|quest|pixel|rpg)\b/i,
  },
  {
    id: 'majors',
    name: 'Majors',
    emoji: '💎',
    seeds: [
      s(BASE, '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'), // cbBTC
      s(BASE, '0x4200000000000000000000000000000000000006'), // WETH
      s(SOL, 'So11111111111111111111111111111111111111112'), // SOL
      s(BNB, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'), // WBNB
    ],
  },
];

export function narrativeById(id: string): NarrativeDef | undefined {
  return NARRATIVES.find((n) => n.id === id);
}

function sameAddress(chainIdentifier: string, a: string, b: string): boolean {
  return chainIdentifier.startsWith('eip155:') ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** The narratives a coin belongs to (ids, in NARRATIVES order). */
export function narrativesOf(coin: { chainIdentifier: string; tokenAddress: string; symbol: string | null; name: string | null }): string[] {
  const text = `${coin.symbol ?? ''} ${coin.name ?? ''}`.trim();
  const out: string[] = [];
  for (const n of NARRATIVES) {
    if (n.seeds?.some((seed) => seed.chainIdentifier === coin.chainIdentifier && sameAddress(coin.chainIdentifier, seed.tokenAddress, coin.tokenAddress))) {
      out.push(n.id);
      continue;
    }
    if (n.chains && !n.chains.includes(coin.chainIdentifier)) continue;
    const bySuffix = n.addressSuffix ? coin.tokenAddress.toLowerCase().endsWith(n.addressSuffix) : false;
    const byWords = n.keywords ? n.keywords.test(text) : false;
    if (bySuffix || byWords) out.push(n.id);
  }
  return out;
}

export interface NarrativeToken {
  chainIdentifier: string;
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  priceUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  volume1hUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  /** Price 24h, 6h, 1h and 5m ago and now — five real points from the pool's own changes. */
  spark: number[];
  /** 0-100: this coin's own volume acceleration and 1h move. */
  heat: number;
}

export interface NarrativeLiveRoom {
  id: string;
  title: string;
  viewers: number;
  hostUsername: string;
  symbol: string | null;
}

export interface NarrativeSignals {
  /** 1h volume × 24 ÷ 24h volume — 1 is a normal hour, 3 is three times busier. */
  volumeAcceleration: number | null;
  /** Confirmed Kamby trades in the last hour. */
  kambyTrades1h: number;
  /** People watching streams about these coins right now. */
  liveViewers: number;
  /** Buys minus sells in the last 24h by this week's top traders. */
  leaderNetBuys: number;
}

export interface NarrativeSummary {
  id: string;
  name: string;
  emoji: string;
  heat: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume1hUsd: number;
  volume24hUsd: number;
  /** Volume-weighted 24h move. */
  change24hPct: number | null;
  tokenCount: number;
  /** The coins, hottest first (up to 10). */
  tokens: NarrativeToken[];
  live: NarrativeLiveRoom[];
  signals: NarrativeSignals;
}

export interface NarrativesSnapshot {
  narratives: NarrativeSummary[];
  atIso: string;
}

export type HeatTier = 'superheated' | 'hot' | 'warming' | 'cool';

export function heatTier(heat: number): HeatTier {
  return heat >= 80 ? 'superheated' : heat >= 60 ? 'hot' : heat >= 40 ? 'warming' : 'cool';
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const saturate = (x: number, half: number) => (x > 0 ? 1 - Math.exp((-x * Math.LN2) / half) : 0);

/** One signal's 0-1 score, or null when it has no data at all. */
export function signalScores(s: NarrativeSignals): { volume: number | null; kamby: number; live: number; leaders: number } {
  return {
    // 1× (a normal hour) scores 0.25, 2× 0.5, 3.5×+ the full 1.
    volume: s.volumeAcceleration === null ? null : clamp01(s.volumeAcceleration / 3.5) ** 0.9,
    kamby: saturate(s.kambyTrades1h, 5),
    live: saturate(s.liveViewers, 15),
    leaders: saturate(Math.max(0, s.leaderNetBuys), 3),
  };
}

const WEIGHTS = { volume: 0.45, kamby: 0.2, live: 0.15, leaders: 0.2 } as const;

/**
 * Heat Index 0-100 from the four signals. A signal that has no data anywhere on Kamby this
 * minute (`active[k] === false` — e.g. nobody is streaming at all) is left out and the others
 * re-weighted, so a quiet Kamby doesn't pin every narrative near zero; within an active signal,
 * a narrative with none of it scores 0 for that part.
 */
export function heatIndex(signals: NarrativeSignals, active: { volume: boolean; kamby: boolean; live: boolean; leaders: boolean }): number {
  const scores = signalScores(signals);
  let total = 0;
  let weight = 0;
  for (const key of ['volume', 'kamby', 'live', 'leaders'] as const) {
    const score = scores[key];
    if (!active[key] || score === null) continue;
    total += WEIGHTS[key] * score;
    weight += WEIGHTS[key];
  }
  return weight > 0 ? Math.round((total / weight) * 100) : 0;
}

/** A single coin's heat: its volume acceleration, nudged by its 1h move. */
export function tokenHeat(token: Pick<NarrativeToken, 'volume1hUsd' | 'volume24hUsd' | 'change1hPct'>): number {
  const v1 = token.volume1hUsd ?? 0;
  const v24 = token.volume24hUsd ?? 0;
  const accel = v24 > 0 ? (v1 * 24) / v24 : 0;
  const move = token.change1hPct ?? 0;
  return Math.round(100 * clamp01(0.8 * clamp01(accel / 3.5) + 0.2 * clamp01((move + 5) / 25)));
}

/** Five real price points (24h, 6h, 1h, 5m ago, now) from a pool's own % changes. */
export function sparkFromChanges(price: number | null, changes: { h24?: number; h6?: number; h1?: number; m5?: number }): number[] {
  if (!price || !(price > 0)) return [];
  const back = (pct: number | undefined) => (typeof pct === 'number' && Number.isFinite(pct) && pct > -100 ? price / (1 + pct / 100) : null);
  const points = [back(changes.h24), back(changes.h6), back(changes.h1), back(changes.m5), price];
  return points.every((p) => p !== null) ? (points as number[]) : [];
}
