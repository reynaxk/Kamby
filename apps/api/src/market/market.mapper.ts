import type { MarketSummary } from '@kamby/domain';
import { isPriceStale } from '@kamby/domain';
import type { Prisma, SolanaTokenMarket } from '@kamby/db';

export type MarketRow = Prisma.TokenMarketGetPayload<{
  include: { token: true; quoteToken: true; chain: true };
}>;

const toNumber = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));

/** The one place a raw DB row becomes the shape the web app reads — Decimal/BigInt
 *  normalized to JSON-safe numbers, staleness computed, nothing fabricated. */
export function toMarketSummary(row: MarketRow, discoveryScore?: number | null): MarketSummary {
  return {
    chainIdentifier: row.chain.identifier,
    tokenAddress: row.token.contractAddress,
    symbol: row.token.symbol,
    name: row.token.name,
    decimals: row.token.decimals,
    logoUrl: row.token.logoUrl,
    quoteSymbol: row.quoteToken.symbol,
    quoteAddress: row.quoteToken.contractAddress,
    quoteDecimals: row.quoteToken.decimals,
    dex: row.dex,
    feeTier: row.feeTier,
    priceUsd: toNumber(row.priceUsd),
    liquidityUsd: toNumber(row.liquidityUsd),
    volume24hUsd: toNumber(row.volume24hUsd),
    priceChange24hPct: toNumber(row.priceChange24hPct),
    marketCapUsd: toNumber(row.marketCapUsd),
    lastPriceUpdateAt: row.lastPriceUpdateAt ? row.lastPriceUpdateAt.toISOString() : null,
    isStale: isPriceStale(row.lastPriceUpdateAt),
    ...(discoveryScore !== undefined ? { discoveryScore } : {}),
  };
}

/** SolanaTokenMarket's counterpart to toMarketSummary above — see that model's own doc
 *  comment in schema.prisma. `chainIdentifier: 'solana'` matches the bare-string convention
 *  LeaderboardChainFilter already uses for Solana (packages/domain/src/pnl.ts) rather than
 *  inventing a CAIP-2-style identifier nothing else in the codebase uses. decimals/feeTier
 *  are null, not fabricated — DexScreener's pair response doesn't carry token decimals. */
export function toSolanaMarketSummary(row: SolanaTokenMarket, discoveryScore?: number | null): MarketSummary {
  return {
    chainIdentifier: 'solana',
    tokenAddress: row.mintAddress,
    symbol: row.symbol,
    name: row.name,
    decimals: null,
    logoUrl: row.logoUrl,
    quoteSymbol: row.quoteSymbol,
    quoteAddress: row.quoteMintAddress,
    quoteDecimals: null,
    dex: row.dex,
    feeTier: null,
    priceUsd: toNumber(row.priceUsd),
    liquidityUsd: toNumber(row.liquidityUsd),
    volume24hUsd: toNumber(row.volume24hUsd),
    priceChange24hPct: toNumber(row.priceChange24hPct),
    marketCapUsd: toNumber(row.marketCapUsd),
    lastPriceUpdateAt: row.lastPriceUpdateAt ? row.lastPriceUpdateAt.toISOString() : null,
    isStale: isPriceStale(row.lastPriceUpdateAt),
    ...(discoveryScore !== undefined ? { discoveryScore } : {}),
  };
}
