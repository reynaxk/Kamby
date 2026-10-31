import { z } from 'zod';

/**
 * Crypto news (2026-10-31): headlines from five public RSS feeds, polled by the workers and
 * streamed to the app. Only the title, a short summary and a link back to the article are
 * kept — the article itself stays on the publisher's site.
 */

/** Redis pub/sub channel the workers publish each new headline on (full NewsItem JSON). */
export const NEWS_REALTIME_CHANNEL = 'kamby:news:new';
/** The latest headlines as one JSON array, rewritten every poll (24h TTL). */
export const NEWS_LATEST_REDIS_KEY = 'kamby:news:latest';
export const NEWS_LATEST_MAX = 100;

export interface NewsSource {
  id: string;
  name: string;
  feedUrl: string;
  /** The publisher's site — article links must stay on it, and its favicon is the logo. */
  site: string;
}

export const NEWS_SOURCES: readonly NewsSource[] = [
  { id: 'coindesk', name: 'CoinDesk', feedUrl: 'https://www.coindesk.com/arc/outboundfeeds/rss', site: 'https://www.coindesk.com' },
  { id: 'cointelegraph', name: 'Cointelegraph', feedUrl: 'https://cointelegraph.com/rss', site: 'https://cointelegraph.com' },
  { id: 'decrypt', name: 'Decrypt', feedUrl: 'https://decrypt.co/feed', site: 'https://decrypt.co' },
  { id: 'blockworks', name: 'Blockworks', feedUrl: 'https://blockworks.com/feed', site: 'https://blockworks.com' },
  { id: 'bitcoinmagazine', name: 'Bitcoin Magazine', feedUrl: 'https://bitcoinmagazine.com/feed', site: 'https://bitcoinmagazine.com' },
];

export function newsSourceById(id: string): NewsSource | undefined {
  return NEWS_SOURCES.find((s) => s.id === id);
}

export const NewsTokenSchema = z.object({
  symbol: z.string(),
  chainIdentifier: z.string(),
  tokenAddress: z.string(),
});
export type NewsToken = z.infer<typeof NewsTokenSchema>;

export const NewsItemSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  summary: z.string(),
  url: z.string().url(),
  publishedAt: z.string().datetime(),
  tokens: z.array(NewsTokenSchema),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export interface NewsPage {
  items: NewsItem[];
  /** Pass back as `before` for the next (older) page; null at the end. */
  nextBefore: string | null;
}

/** "eip155:8453:0xabc…" / "solana:Mint…" — EVM addresses lower-cased so lookups match any casing. */
export function newsTokenKey(chainIdentifier: string, tokenAddress: string): string {
  return `${chainIdentifier}:${chainIdentifier.startsWith('eip155:') ? tokenAddress.toLowerCase() : tokenAddress}`;
}

interface VerifiedTicker {
  symbol: string;
  chainIdentifier: string;
  tokenAddress: string;
  /** Plain words that mean this coin in a headline ("Bitcoin"), matched case-sensitively. */
  names?: string[];
  /** Big coins every outlet covers; trusted without the workers' liquidity check. */
  major?: boolean;
  /** A bare upper-case word ("BONK") counts too, not only a cashtag. Off for tickers that
   *  are ordinary words or acronyms ("UNI", "RAY"). */
  bareTicker?: boolean;
}

/**
 * The only coins a headline can be tagged with — Kamby's own verified markets (the seed lists),
 * never "any coin called PEPE": every popular ticker has copycats. Article tags open the real
 * coin by contract address.
 */
export const NEWS_VERIFIED_TICKERS: readonly VerifiedTicker[] = [
  { symbol: 'BTC', chainIdentifier: 'eip155:8453', tokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', names: ['Bitcoin'], major: true, bareTicker: true },
  { symbol: 'ETH', chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006', names: ['Ethereum', 'Ether'], major: true, bareTicker: true },
  { symbol: 'SOL', chainIdentifier: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112', names: ['Solana'], major: true, bareTicker: true },
  { symbol: 'BNB', chainIdentifier: 'eip155:56', tokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', major: true, bareTicker: true },
  { symbol: 'BONK', chainIdentifier: 'solana', tokenAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', names: ['Bonk'], bareTicker: true },
  { symbol: 'WIF', chainIdentifier: 'solana', tokenAddress: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', names: ['dogwifhat'], bareTicker: true },
  { symbol: 'JUP', chainIdentifier: 'solana', tokenAddress: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', bareTicker: true },
  { symbol: 'JTO', chainIdentifier: 'solana', tokenAddress: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', names: ['Jito'], bareTicker: true },
  { symbol: 'PYTH', chainIdentifier: 'solana', tokenAddress: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', names: ['Pyth Network'], bareTicker: true },
  { symbol: 'RAY', chainIdentifier: 'solana', tokenAddress: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', names: ['Raydium'] },
  { symbol: 'DEGEN', chainIdentifier: 'eip155:8453', tokenAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
  { symbol: 'BRETT', chainIdentifier: 'eip155:8453', tokenAddress: '0x532f27101965dd16442E59d40670FaF5eBB142E4', bareTicker: true },
  { symbol: 'TOSHI', chainIdentifier: 'eip155:8453', tokenAddress: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', bareTicker: true },
  { symbol: 'VIRTUAL', chainIdentifier: 'eip155:8453', tokenAddress: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b', names: ['Virtuals Protocol'] },
  { symbol: 'CLANKER', chainIdentifier: 'eip155:8453', tokenAddress: '0x1bc0c42215582d5A085795f4baDbaC3ff36d1Bcb' },
  { symbol: 'MORPHO', chainIdentifier: 'eip155:8453', tokenAddress: '0xBAa5CC21fd487B8Fcc2F632f3F4E8D37262a0842', names: ['Morpho'], bareTicker: true },
  { symbol: 'AAVE', chainIdentifier: 'eip155:8453', tokenAddress: '0x63706e401c06ac8513145b7687A14804d17f814b', names: ['Aave'], bareTicker: true },
  { symbol: 'ZORA', chainIdentifier: 'eip155:8453', tokenAddress: '0x1111111111166b7FE7bd91427724B487980aFc69', names: ['Zora'], bareTicker: true },
  { symbol: 'AERO', chainIdentifier: 'eip155:8453', tokenAddress: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', names: ['Aerodrome'] },
  { symbol: 'UNI', chainIdentifier: 'eip155:8453', tokenAddress: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83', names: ['Uniswap'] },
  { symbol: 'AIXBT', chainIdentifier: 'eip155:8453', tokenAddress: '0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825', bareTicker: true },
  { symbol: 'CAKE', chainIdentifier: 'eip155:56', tokenAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', names: ['PancakeSwap'] },
  { symbol: 'TWT', chainIdentifier: 'eip155:56', tokenAddress: '0x4B0F1812e5Df2A09796481Ff14017e6005508003', names: ['Trust Wallet Token'] },
];

const MAX_TAGS = 3;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The verified coins a headline (+ summary) mentions, by cashtag ("$SOL"), a bare upper-case
 * ticker where that's unambiguous ("BONK"), or the coin's name ("Solana"). Title matches rank
 * first; at most three tags.
 */
export function matchNewsTickers(title: string, summary: string): VerifiedTicker[] {
  const found: VerifiedTicker[] = [];
  for (const text of [title, summary]) {
    for (const ticker of NEWS_VERIFIED_TICKERS) {
      if (found.includes(ticker)) continue;
      const sym = escapeRegExp(ticker.symbol);
      const patterns = [new RegExp(`\\$${sym}\\b`, 'i')];
      if (ticker.bareTicker) patterns.push(new RegExp(`(?<![\\w$])${sym}(?![\\w])`));
      for (const name of ticker.names ?? []) patterns.push(new RegExp(`(?<![\\w-])${escapeRegExp(name)}(?![\\w-])`));
      if (patterns.some((re) => re.test(text))) found.push(ticker);
    }
  }
  return found.slice(0, MAX_TAGS);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s: string): string {
  // Twice: feeds double-encode ("&amp;#039;").
  let out = s;
  for (let i = 0; i < 2; i++) {
    out = out.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    });
  }
  return out;
}

/** Plain text from feed HTML: scripts/styles/images (tracking pixels) dropped, tags stripped,
 *  entities decoded, whitespace collapsed. */
export function cleanNewsText(html: string | null | undefined): string {
  if (!html) return '';
  const noBlocks = html.replace(/<(script|style|iframe|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const noTags = noBlocks.replace(/<[^>]*>/g, ' ');
  return decodeEntities(noTags).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A summary for a card: first ~220 characters, cut at a word. */
export function newsSnippet(text: string, max = 220): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

/** The article link without tracking parameters, or null unless it's https on the publisher's
 *  own site (a feed pointing elsewhere is not linked). */
export function canonicalNewsUrl(raw: string | null | undefined, source: NewsSource): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const siteHost = new URL(source.site).hostname.replace(/^www\./, '');
  const host = url.hostname.replace(/^www\./, '');
  if (host !== siteHost && !host.endsWith(`.${siteHost}`)) return null;
  url.protocol = 'https:';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|mc_|fbclid|gclid|ref$|src$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hash = '';
  return url.toString();
}

/** Headline normalised for de-duplication: the same story re-posted or re-dated by a feed
 *  hashes the same. */
export function normalizeNewsTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
