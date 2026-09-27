import { prisma } from '@kamby/db';
import type { Logger } from 'pino';
import { SOLANA_SEED_MARKETS } from './solana-seed-markets';

/** DexScreener's public API is a genuine source of truth for this pipeline, not just
 *  discovery — see SolanaTokenMarket's own doc comment in schema.prisma for why. */
const DEXSCREENER_TOKENS_URL = 'https://api.dexscreener.com/latest/dex/tokens';

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  baseToken: { address: string; symbol: string | null; name: string | null };
  quoteToken: { address: string; symbol: string | null };
  priceUsd: string | null;
  liquidity?: { usd: number | null };
  volume?: { h24: number | null };
  priceChange?: { h24: number | null };
  fdv?: number | null;
  marketCap?: number | null;
  info?: { imageUrl?: string | null };
}

interface DexScreenerTokenResponse {
  pairs: DexScreenerPair[] | null;
}

export interface SolanaMarketIngestionResult {
  attempted: number;
  updated: number;
  skipped: number;
}

/**
 * Polls DexScreener for each of SOLANA_SEED_MARKETS' mints and upserts a SolanaTokenMarket
 * row per tick — the Solana counterpart to MarketIngestionService (market/ingestion.ts), but
 * far simpler: no cursor, no swap-by-swap indexing, no on-chain reads at all. A tick-based
 * ticker like everything else in main.ts except pumpfun-ingestion.ts's persistent
 * subscription — DexScreener has no push/webhook feed, only request/response.
 *
 * One request per mint per tick (SOLANA_SEED_MARKETS is small — 6 entries as of 2026-09-24),
 * never batched into DexScreener's multi-address form: keeps each mint's failure fully
 * independent (see the try/catch per mint below) and the request shape identical to the
 * verification calls already used to build this seed list, rather than a second, untested
 * code path for the batch form.
 */
export class SolanaMarketIngestionService {
  constructor(private readonly logger: Logger) {}

  async run(): Promise<SolanaMarketIngestionResult> {
    let updated = 0;
    let skipped = 0;

    for (const { mintAddress } of SOLANA_SEED_MARKETS) {
      try {
        const wrote = await this.ingestOne(mintAddress);
        if (wrote) updated += 1;
        else skipped += 1;
      } catch (error) {
        skipped += 1;
        this.logger.error({ err: error, mintAddress }, 'Solana market ingestion: failed to update one mint — will retry next tick');
      }
    }

    return { attempted: SOLANA_SEED_MARKETS.length, updated, skipped };
  }

  /** Returns false (not thrown) for an honestly-empty result — no pairs found, or every
   *  pair missing a usable price — same "skip, don't fabricate" rule seed-markets ingestion
   *  already follows for an unreadable EVM pool. */
  private async ingestOne(mintAddress: string): Promise<boolean> {
    const response = await fetch(`${DEXSCREENER_TOKENS_URL}/${mintAddress}`);
    if (!response.ok) {
      this.logger.warn({ mintAddress, status: response.status }, 'Solana market ingestion: DexScreener request failed');
      return false;
    }

    const body = (await response.json()) as DexScreenerTokenResponse;
    const pairs = (body.pairs ?? []).filter((p) => p.chainId === 'solana' && p.baseToken.address === mintAddress);
    if (pairs.length === 0) return false;

    // Deepest real pool wins — same "the pair with genuine liquidity, not the first result"
    // rule the EVM seed-list research this session already applied by hand.
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    if (best.priceUsd === null) return false;

    await prisma.solanaTokenMarket.upsert({
      where: { mintAddress },
      update: {
        symbol: best.baseToken.symbol,
        name: best.baseToken.name,
        logoUrl: best.info?.imageUrl ?? null,
        quoteMintAddress: best.quoteToken.address,
        quoteSymbol: best.quoteToken.symbol,
        dex: best.dexId,
        priceUsd: best.priceUsd,
        liquidityUsd: best.liquidity?.usd ?? null,
        volume24hUsd: best.volume?.h24 ?? null,
        priceChange24hPct: best.priceChange?.h24 ?? null,
        marketCapUsd: best.marketCap ?? best.fdv ?? null,
        lastPriceUpdateAt: new Date(),
      },
      create: {
        mintAddress,
        symbol: best.baseToken.symbol,
        name: best.baseToken.name,
        logoUrl: best.info?.imageUrl ?? null,
        quoteMintAddress: best.quoteToken.address,
        quoteSymbol: best.quoteToken.symbol,
        dex: best.dexId,
        priceUsd: best.priceUsd,
        liquidityUsd: best.liquidity?.usd ?? null,
        volume24hUsd: best.volume?.h24 ?? null,
        priceChange24hPct: best.priceChange?.h24 ?? null,
        marketCapUsd: best.marketCap ?? best.fdv ?? null,
        lastPriceUpdateAt: new Date(),
      },
    });
    return true;
  }
}
