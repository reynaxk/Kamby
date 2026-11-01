import { PREDICTION_LIMITS, type PredictionCategory } from '@kamby/domain';
import type { Draft } from './predictions-cron.service';

/**
 * Politics and crypto-event questions (2026-11-01) — elections, "Will X launch a token", "Fed
 * cuts" — that Kamby can't decide from a pool price. The question text and the real outcome come
 * from Polymarket's public data; Kamby never shows its odds, never links there, and votes stay
 * free. These stay open until the event's own end date, then resolve when the market does.
 */

const GAMMA = 'https://gamma-api.polymarket.com';
/** Open questions of each kind Kamby keeps at once. */
export const EVENT_CAPS: Record<'politics' | 'crypto', number> = { politics: 30, crypto: 30 };
/** Nothing that ends further out than this — a 2028 election is no fun to wait for. */
const MAX_DAYS_OUT = 120;
/** Questions already as good as decided (one side ≥ 97%) are skipped. */
const DECIDED = 0.97;
/** Kamby's owner is under 18 and this is a social app: no war, violence or death questions. */
const BLOCKED = /\b(war|strike|attack|invade|invasion|kill|killed|die|dies|death|dead|assassinat\w*|bomb\w*|nuclear|missile|troops|ceasefire|hostage|shoot\w*|terror\w*|sex\w*|porn\w*|drug\w*|arrest\w*|indict\w*|jail|prison)\b/i;

/** Questions about a major get its chart on the card (cbBTC / WETH on Base, SOL, WBNB). */
const MAJORS: { match: RegExp; symbol: string; chainIdentifier: string; tokenAddress: string }[] = [
  { match: /\b(bitcoin|btc)\b/i, symbol: 'BTC', chainIdentifier: 'eip155:8453', tokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' },
  { match: /\b(ethereum|eth)\b/i, symbol: 'ETH', chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006' },
  { match: /\b(solana|sol)\b/i, symbol: 'SOL', chainIdentifier: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112' },
  { match: /\bbnb\b/i, symbol: 'BNB', chainIdentifier: 'eip155:56', tokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
];

/** Exported for tests. The coin a question is about and its one price line ("above $78,000"), if any. */
export function eventCoin(question: string): { coin: { chainIdentifier: string; tokenAddress: string }; symbol: string; threshold: number | null } | null {
  const major = MAJORS.find((m) => m.match.test(question));
  if (!major) return null;
  const amounts = [...question.matchAll(/\$([\d,]+(?:\.\d+)?)\s*(k)?\b/gi)].map((m) => Number(m[1]!.replace(/,/g, '')) * (m[2] ? 1000 : 1));
  return { coin: { chainIdentifier: major.chainIdentifier, tokenAddress: major.tokenAddress }, symbol: major.symbol, threshold: amounts.length === 1 && amounts[0]! > 0 ? amounts[0]! : null };
}

export interface GammaMarket {
  id: string;
  question: string;
  outcomes: string;
  outcomePrices?: string;
  endDate?: string;
  closed?: boolean;
  active?: boolean;
  volume24hr?: number;
  umaResolutionStatus?: string;
}

interface GammaEvent {
  id: string;
  title: string;
  endDate?: string;
  markets: GammaMarket[];
}

const parse = (raw: string | undefined): string[] => {
  try {
    const v = JSON.parse(raw ?? '[]') as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** Exported for tests. One question per event — its most-traded open market that's still a real question. */
export function eventDrafts(events: GammaEvent[], category: 'politics' | 'crypto', now = Date.now()): Draft[] {
  const out: Draft[] = [];
  for (const e of events) {
    if (BLOCKED.test(e.title)) continue;
    const pick = e.markets
      .filter((m) => {
        if (m.closed || m.active === false || BLOCKED.test(m.question)) return false;
        const end = Date.parse(m.endDate ?? e.endDate ?? '');
        if (!Number.isFinite(end) || end < now + 2 * 3600_000 || end > now + MAX_DAYS_OUT * 86_400_000) return false;
        const outcomes = parse(m.outcomes);
        if (outcomes.length < PREDICTION_LIMITS.minOptions || outcomes.length > PREDICTION_LIMITS.maxOptions) return false;
        if (outcomes.some((o) => o.length > PREDICTION_LIMITS.optionMax)) return false;
        const prices = parse(m.outcomePrices).map(Number);
        return !prices.some((p) => p >= DECIDED);
      })
      .sort((a, b) => (b.volume24hr ?? 0) - (a.volume24hr ?? 0))[0];
    if (!pick) continue;
    const title = pick.question.length > PREDICTION_LIMITS.titleMax ? `${pick.question.slice(0, PREDICTION_LIMITS.titleMax - 1).trimEnd()}…` : pick.question;
    const options = parse(pick.outcomes);
    const about = eventCoin(pick.question);
    out.push({
      title,
      category: category as PredictionCategory,
      kind: options.length === 2 ? 'BINARY' : 'MULTI_CHOICE',
      options,
      resolutionType: 'EXTERNAL_EVENT',
      source: 'AUTO_EVENT',
      ...(about && { coin: about.coin }),
      meta: { marketId: pick.id, ...(about && { symbol: about.symbol, ...(about.threshold !== null && { threshold: about.threshold }) }) },
      endsAt: Date.parse(pick.endDate ?? e.endDate ?? ''),
      hours: 0,
      dedupeKey: `event:${pick.id}`,
    });
  }
  return out;
}

export async function fetchEventDrafts(category: 'politics' | 'crypto'): Promise<Draft[]> {
  const res = await fetch(`${GAMMA}/events?tag_slug=${category}&active=true&closed=false&limit=100&order=volume24hr&ascending=false`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Polymarket events ${res.status}`);
  const body = (await res.json()) as unknown;
  return eventDrafts(Array.isArray(body) ? (body as GammaEvent[]) : [], category);
}

/** The winning option once the real event is settled, else null (still waiting). */
export function eventOutcome(m: GammaMarket): number | null {
  if (!m.closed) return null;
  const prices = parse(m.outcomePrices).map(Number);
  const win = prices.findIndex((p) => p >= 0.99);
  return win >= 0 ? win : null;
}

export async function fetchEventOutcome(marketId: string): Promise<number | null> {
  const res = await fetch(`${GAMMA}/markets/${encodeURIComponent(marketId)}`, { signal: AbortSignal.timeout(8_000) });
  if (!res.ok) return null;
  return eventOutcome((await res.json()) as GammaMarket);
}
