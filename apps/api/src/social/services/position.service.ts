import { Injectable } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { PnlHistory, PnlHistoryPoint, TokenPosition } from '@kamby/domain';
import { formatUnits } from 'viem';

/**
 * A signed-in user's currently-open positions — see TokenPositionSchema's own doc comment
 * for exactly what "open" and "remaining" mean here. Reads TokenLot directly (never read
 * anywhere in apps/api before this — see docs/TRADER_INTELLIGENCE.md#realized-pnl for the
 * ledger it's part of), grouped by token since one token can have several lots (one per
 * BUY). EVM-only for now: current price comes from TokenMarket, which has no Solana
 * counterpart yet.
 */
@Injectable()
export class PositionService {
  async getMine(userId: string): Promise<TokenPosition[]> {
    const lots = await prisma.tokenLot.findMany({
      where: { userId, chain: 'EVM', evmTokenId: { not: null } },
      select: { evmTokenId: true, quantityOriginalRaw: true, quantityRemainingRaw: true, costBasisUsd: true },
    });
    if (lots.length === 0) return [];

    const tokenIds = [...new Set(lots.map((lot) => lot.evmTokenId as string))];
    const [tokens, markets] = await Promise.all([
      prisma.token.findMany({
        where: { id: { in: tokenIds } },
        select: { id: true, contractAddress: true, symbol: true, name: true, decimals: true, logoUrl: true },
      }),
      // Highest-liquidity market per token — same deepest-pool convention MarketService
      // already uses when a token trades through more than one pool.
      prisma.tokenMarket.findMany({
        where: { tokenId: { in: tokenIds } },
        select: { tokenId: true, priceUsd: true },
        orderBy: { liquidityUsd: 'desc' },
      }),
    ]);
    const tokenById = new Map(tokens.map((t) => [t.id, t]));
    const priceByToken = new Map<string, number>();
    for (const market of markets) {
      if (priceByToken.has(market.tokenId) || market.priceUsd === null) continue;
      priceByToken.set(market.tokenId, Number(market.priceUsd));
    }

    const lotsByToken = new Map<string, typeof lots>();
    for (const lot of lots) {
      const tokenId = lot.evmTokenId as string;
      const existing = lotsByToken.get(tokenId);
      if (existing) existing.push(lot);
      else lotsByToken.set(tokenId, [lot]);
    }

    const positions: TokenPosition[] = [];
    for (const [tokenId, tokenLots] of lotsByToken) {
      const token = tokenById.get(tokenId);
      // Never compute a quantity off unresolved decimals — same guard TradePanelCard
      // applies before ever passing a market's decimals onward.
      if (!token || token.decimals === null) continue;

      let remainingRaw = 0n;
      let remainingCostBasisUsd = 0;
      for (const lot of tokenLots) {
        const original = BigInt(lot.quantityOriginalRaw);
        const remaining = BigInt(lot.quantityRemainingRaw);
        remainingRaw += remaining;
        if (original > 0n) {
          remainingCostBasisUsd += Number(lot.costBasisUsd) * (Number(remaining) / Number(original));
        }
      }
      if (remainingRaw <= 0n) continue; // fully closed — see the schema's own doc comment

      const quantity = Number(formatUnits(remainingRaw, token.decimals));
      const currentPriceUsd = priceByToken.get(tokenId) ?? null;
      const currentValueUsd = currentPriceUsd !== null ? quantity * currentPriceUsd : null;
      const unrealizedPnlUsd = currentValueUsd !== null ? currentValueUsd - remainingCostBasisUsd : null;
      const unrealizedPnlPct =
        unrealizedPnlUsd !== null && remainingCostBasisUsd > 0 ? (unrealizedPnlUsd / remainingCostBasisUsd) * 100 : null;

      positions.push({
        tokenAddress: token.contractAddress,
        symbol: token.symbol,
        name: token.name,
        logoUrl: token.logoUrl,
        quantity,
        costBasisUsd: remainingCostBasisUsd,
        currentPriceUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct,
      });
    }

    return positions.sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));
  }

  /** See PnlHistoryPointSchema's own doc comment (packages/domain/src/pnl.ts) for why this
   *  is realized PnL over time, not a mark-to-market portfolio-value curve. Cumulative
   *  total resets to 0 at the start of the requested window (a "last N days" chart, not
   *  all-time-since-inception) — every day in range appears, including zero-activity ones,
   *  with a real `0` for that day's own delta rather than a gap. A single user's own event
   *  volume is small enough to bucket in JS rather than needing a SQL date_trunc GROUP BY. */
  async getMyPnlHistory(userId: string, days: number): Promise<PnlHistory> {
    const todayUtc = startOfUtcDay(new Date());
    const since = new Date(todayUtc.getTime() - (days - 1) * 24 * 60 * 60 * 1000);

    const events = await prisma.realizedPnlEvent.findMany({
      where: { userId, confirmedAt: { gte: since } },
      select: { confirmedAt: true, realizedPnlUsd: true },
    });

    const deltaByDate = new Map<string, number>();
    for (const event of events) {
      const date = utcDateKey(event.confirmedAt);
      deltaByDate.set(date, (deltaByDate.get(date) ?? 0) + Number(event.realizedPnlUsd));
    }

    const points: PnlHistoryPoint[] = [];
    let cumulative = 0;
    for (let i = 0; i < days; i++) {
      const day = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const date = utcDateKey(day);
      const realizedPnlUsd = deltaByDate.get(date) ?? 0;
      cumulative += realizedPnlUsd;
      points.push({ date, realizedPnlUsd, cumulativeRealizedPnlUsd: cumulative });
    }

    return { days, points };
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}
