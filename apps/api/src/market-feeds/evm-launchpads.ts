import type { XxxRiskColumn, XxxRiskToken } from '@kamby/domain';

/**
 * New coins on Kamby's EVM chains for the launchpad board (2026-11-01, owner: "all the launchpads,
 * not only Pump.fun"): GeckoTerminal's newest pools on BNB, Base and Robinhood, each labelled with
 * the launchpad it came from where that's certain — Four.meme's own curve pools (and its "…4444"
 * coins once they move to PancakeSwap), Clanker's "…b07" coins, Pons on Robinhood — and with the
 * DEX otherwise. These have no Jupiter audit, so every one is marked unaudited.
 */

export const EVM_NETWORKS: { network: string; chainIdentifier: string }[] = [
  { network: 'bsc', chainIdentifier: 'eip155:56' },
  { network: 'base', chainIdentifier: 'eip155:8453' },
  { network: 'robinhood', chainIdentifier: 'eip155:4663' },
];

/** A pool must hold this much, and be this young, to be shown. */
const MIN_LIQUIDITY_USD = 1_000;
const MIN_MARKET_CAP_USD = 3_000;
const MAX_AGE_MS = 24 * 3600_000;

export interface GtPool {
  id: string;
  attributes: {
    address?: string;
    name?: string;
    pool_created_at?: string;
    base_token_price_usd?: string | null;
    fdv_usd?: string | null;
    market_cap_usd?: string | null;
    reserve_in_usd?: string | null;
    volume_usd?: { m5?: string | null };
    transactions?: { m5?: { buys?: number; sells?: number; buyers?: number; sellers?: number } };
    price_change_percentage?: { m5?: string | null };
  };
  relationships?: { base_token?: { data?: { id?: string } }; dex?: { data?: { id?: string } } };
}
export interface GtToken {
  id: string;
  type: string;
  attributes: { address?: string; name?: string; symbol?: string; image_url?: string | null };
}

const n = (v: string | number | null | undefined): number | null => {
  const x = typeof v === 'number' ? v : v == null ? NaN : Number(v);
  return Number.isFinite(x) ? x : null;
};

/** Exported for tests. The launchpad (or DEX) a new EVM pool came from, and its column. */
export function launchpadOf(dex: string, tokenAddress: string): { launchpad: string; column: XxxRiskColumn } {
  const a = tokenAddress.toLowerCase();
  if (dex === 'four-meme') return { launchpad: 'four.meme', column: 'new' };
  if (a.endsWith('4444') && dex.startsWith('pancakeswap')) return { launchpad: 'four.meme', column: 'migrated' };
  if (a.endsWith('b07')) return { launchpad: 'clanker', column: 'new' };
  if (dex.startsWith('pons')) return { launchpad: 'pons', column: 'new' };
  if (dex.startsWith('uniswap-v4')) return { launchpad: 'uniswap-v4', column: 'new' };
  if (dex.startsWith('pancakeswap')) return { launchpad: 'pancakeswap', column: 'new' };
  if (dex.startsWith('uniswap')) return { launchpad: 'uniswap', column: 'new' };
  if (dex.startsWith('aerodrome')) return { launchpad: 'aerodrome', column: 'new' };
  return { launchpad: dex, column: 'new' };
}

/** Exported for tests. One new pool as a board card; null when it's too thin, too old or unpriced. */
export function evmPoolToken(pool: GtPool, tokens: Map<string, GtToken>, chainIdentifier: string, now: number): XxxRiskToken | null {
  const a = pool.attributes;
  const tokenId = pool.relationships?.base_token?.data?.id;
  const token = tokenId ? tokens.get(tokenId) : undefined;
  const address = token?.attributes.address ?? tokenId?.split('_').slice(1).join('_');
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const created = Date.parse(a.pool_created_at ?? '');
  const liquidityUsd = n(a.reserve_in_usd) ?? 0;
  const marketCapUsd = n(a.market_cap_usd) ?? n(a.fdv_usd) ?? 0;
  if (!Number.isFinite(created) || now - created > MAX_AGE_MS || liquidityUsd < MIN_LIQUIDITY_USD || marketCapUsd < MIN_MARKET_CAP_USD) return null;
  const tx = a.transactions?.m5;
  const { launchpad, column } = launchpadOf(pool.relationships?.dex?.data?.id ?? '', address);
  const image = token?.attributes.image_url;
  return {
    chainIdentifier,
    mintAddress: address,
    symbol: token?.attributes.symbol ?? a.name?.split(' / ')[0] ?? null,
    name: token?.attributes.name ?? null,
    imageUrl: image?.startsWith('https://') && !image.includes('missing') ? image : null,
    ageSeconds: Math.max(0, Math.round((now - created) / 1000)),
    liquidityUsd,
    marketCapUsd,
    volume5mUsd: n(a.volume_usd?.m5),
    traders5m: tx ? (tx.buyers ?? 0) + (tx.sellers ?? 0) : null,
    riskFlags: ['unverified-audit'],
    createdAtMs: created,
    curvePct: column === 'migrated' ? 100 : undefined,
    holders: null,
    buys5m: tx?.buys ?? null,
    sells5m: tx?.sells ?? null,
    priceChange5mPct: n(a.price_change_percentage?.m5),
    column,
    launchpad,
  };
}
