/**
 * Coin names with slurs in them (found 2026-11-01: a racial slur ticker sat in Home's Trending
 * list). Anyone can launch a token with any name, so browsable lists hide these. Like the
 * lookalike filter it is a display filter only: the coin still opens by its exact address.
 *
 * Matching is on the name squashed to lowercase letters, with common digit swaps undone
 * ("N1GG3R" → "nigger"), so spacing, symbols and leetspeak don't get around it. Every stem is
 * long and specific enough not to hit ordinary words.
 */
const STEMS = ['nigger', 'nigga', 'niggr', 'faggot', 'kike', 'chink', 'spic', 'wetback', 'tranny', 'retard', 'gook', 'beaner', 'raghead', 'coon', 'hitler', 'nazi', 'kkk'];

/** Stems short enough to sit inside ordinary words ("coon" in "raccoon", "spic" in "spicy"):
 *  these count only as a whole ticker or as a separate word of the name. */
const WHOLE_WORD_ONLY = new Set(['kike', 'chink', 'spic', 'gook', 'coon', 'kkk', 'nazi']);

const DIGITS: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function squash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => DIGITS[c] ?? c)
    .replace(/[^a-z]/g, '');
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => DIGITS[c] ?? c)
    .split(/[^a-z]+/)
    .filter(Boolean);
}

export function isOffensiveText(text: string | null | undefined): boolean {
  if (!text) return false;
  const flat = squash(text);
  const parts = words(text);
  return STEMS.some((stem) => (WHOLE_WORD_ONLY.has(stem) ? parts.includes(stem) || flat === stem : flat.includes(stem)));
}

export function isOffensiveCoin(coin: { symbol?: string | null; name?: string | null }): boolean {
  return isOffensiveText(coin.symbol) || isOffensiveText(coin.name);
}

/** Drops offensive coins from every list (array of coin-shaped rows) in a feed payload. */
export function withoutOffensiveCoins<T extends object>(data: T): T {
  const out = { ...data } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (Array.isArray(value)) out[key] = value.filter((row: unknown) => !(row && typeof row === 'object' && isOffensiveCoin(row as { symbol?: string; name?: string })));
  }
  return out as T;
}
