import { Injectable, Optional } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { PnlHistory, PnlHistoryPoint, TokenPosition } from '@kamby/domain';
import { formatUnits } from 'viem';
import { LivePriceService } from '../../market-feeds/live-price.service';

/** Pump.fun coins (and almost every launchpad coin) use 6 decimals. */
const PUMPFUN_DECIMALS = 6;
const MAX_SOLANA_POSITIONS = 20;
/** A position worth less than this is closed for display (sell rounding leaves a few raw units). */
const MIN_POSITION_USD = 0.01;

/** Exported for tests. Under 0.5% of what was bought still held: a sold-out position's rounding
 *  leftover, not a holding (2026-10-06: a sold coin kept showing as a "$0.00" position). */
export function isDust(remainingRaw: bigint, originalRaw: bigint): boolean {
  return remainingRaw <= 0n || (originalRaw > 0n && remainingRaw * 200n < originalRaw);
}

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
  constructor(@Optional() private readonly livePrices?: LivePriceService) {}

  async getMine(userId: string): Promise<TokenPosition[]> {
    const [evm, solana] = await Promise.all([this.evmPositions(userId), this.solanaPositions(userId)]);
    return [...evm, ...solana].sort((a, b) => (b.currentValueUsd ?? 0) - (a.currentValueUsd ?? 0));
  }

  /**
   * Solana holdings (2026-10-05: a user bought a Solana coin and saw no position anywhere —
   * positions were EVM-only). Lots come from the same ledger; the price is the live feed the
   * charts use (DexScreener, or a brand-new coin's bonding curve), the name from Kamby's
   * listing or the Pump.fun record.
   */
  private async solanaPositions(userId: string): Promise<TokenPosition[]> {
    const lots = await prisma.tokenLot.findMany({
      where: { userId, chain: 'SOLANA', solanaMint: { not: null }, quantityRemainingRaw: { not: '0' } },
      select: { solanaMint: true, quantityOriginalRaw: true, quantityRemainingRaw: true, costBasisUsd: true, solanaBuyTransactionId: true },
    });
    if (lots.length === 0) return [];
    const feeByTx = await solanaBuyFees(lots.map((l) => l.solanaBuyTransactionId).filter((id): id is string => id !== null));
    const lotsByMint = new Map<string, typeof lots>();
    for (const lot of lots) lotsByMint.set(lot.solanaMint!, [...(lotsByMint.get(lot.solanaMint!) ?? []), lot]);
    const mints = [...lotsByMint.keys()].slice(0, MAX_SOLANA_POSITIONS);
    const [listed, pumpFun, prices] = await Promise.all([
      prisma.solanaTokenMarket.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true, name: true, decimals: true, logoUrl: true } }),
      prisma.pumpFunToken.findMany({ where: { mintAddress: { in: mints } }, select: { mintAddress: true, symbol: true, name: true } }),
      Promise.all(mints.map((mint) => (this.livePrices ? this.livePrices.price('solana', mint).catch(() => null) : Promise.resolve(null)))),
    ]);
    const listedByMint = new Map(listed.map((m) => [m.mintAddress, m]));
    const pumpByMint = new Map(pumpFun.map((t) => [t.mintAddress, t]));

    return mints.flatMap((mint, i): TokenPosition[] => {
      const meta = listedByMint.get(mint);
      const pump = pumpByMint.get(mint);
      const decimals = meta?.decimals ?? (pump ? PUMPFUN_DECIMALS : null);
      if (decimals === null) return []; // never compute a quantity off unknown decimals
      let remainingRaw = 0n;
      let originalRaw = 0n;
      let remainingCostBasisUsd = 0;
      let remainingFeesUsd = 0;
      for (const lot of lotsByMint.get(mint)!) {
        const original = BigInt(lot.quantityOriginalRaw);
        originalRaw += original;
        const remaining = BigInt(lot.quantityRemainingRaw);
        remainingRaw += remaining;
        if (original > 0n) {
          const share = Number(remaining) / Number(original);
          remainingCostBasisUsd += Number(lot.costBasisUsd) * share;
          remainingFeesUsd += (lot.solanaBuyTransactionId ? (feeByTx.get(lot.solanaBuyTransactionId) ?? 0) : 0) * share;
        }
      }
      if (isDust(remainingRaw, originalRaw)) return [];
      const quantity = Number(formatUnits(remainingRaw, decimals));
      const currentPriceUsd = prices[i]?.priceUsd ?? null;
      const currentValueUsd = currentPriceUsd !== null ? quantity * currentPriceUsd : null;
      if (currentValueUsd !== null && currentValueUsd < MIN_POSITION_USD) return [];
      const unrealizedPnlUsd = currentValueUsd !== null ? currentValueUsd - remainingCostBasisUsd : null;
      return [
        {
          tokenAddress: mint,
          chain: 'solana',
          symbol: meta?.symbol ?? pump?.symbol ?? null,
          name: meta?.name ?? pump?.name ?? null,
          logoUrl: meta?.logoUrl ?? null,
          quantity,
          costBasisUsd: remainingCostBasisUsd,
          currentPriceUsd,
          currentValueUsd,
          unrealizedPnlUsd,
          unrealizedPnlPct: unrealizedPnlUsd !== null && remainingCostBasisUsd > 0 ? (unrealizedPnlUsd / remainingCostBasisUsd) * 100 : null,
          feesUsd: Math.min(remainingFeesUsd, remainingCostBasisUsd),
        },
      ];
    });
  }

  private async evmPositions(userId: string): Promise<TokenPosition[]> {
    const lots = await prisma.tokenLot.findMany({
      where: { userId, chain: 'EVM', evmTokenId: { not: null } },
      select: { evmTokenId: true, quantityOriginalRaw: true, quantityRemainingRaw: true, costBasisUsd: true, evmBuyTransactionId: true },
    });
    if (lots.length === 0) return [];
    const feeBpsByTx = await evmBuyFeeBps(lots.map((l) => l.evmBuyTransactionId).filter((id): id is string => id !== null));

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
      let originalRaw = 0n;
      let remainingCostBasisUsd = 0;
      let remainingFeesUsd = 0;
      for (const lot of tokenLots) {
        const original = BigInt(lot.quantityOriginalRaw);
        originalRaw += original;
        const remaining = BigInt(lot.quantityRemainingRaw);
        remainingRaw += remaining;
        if (original > 0n) {
          const share = Number(remaining) / Number(original);
          remainingCostBasisUsd += Number(lot.costBasisUsd) * share;
          // EVM buys take the fee off the USDC entered, so it's that share of the lot's cost.
          const bps = lot.evmBuyTransactionId ? (feeBpsByTx.get(lot.evmBuyTransactionId) ?? 0) : 0;
          remainingFeesUsd += Number(lot.costBasisUsd) * (bps / 10_000) * share;
        }
      }
      if (isDust(remainingRaw, originalRaw)) continue; // closed — see isDust

      const quantity = Number(formatUnits(remainingRaw, token.decimals));
      const currentPriceUsd = priceByToken.get(tokenId) ?? null;
      const currentValueUsd = currentPriceUsd !== null ? quantity * currentPriceUsd : null;
      if (currentValueUsd !== null && currentValueUsd < MIN_POSITION_USD) continue;
      const unrealizedPnlUsd = currentValueUsd !== null ? currentValueUsd - remainingCostBasisUsd : null;
      const unrealizedPnlPct =
        unrealizedPnlUsd !== null && remainingCostBasisUsd > 0 ? (unrealizedPnlUsd / remainingCostBasisUsd) * 100 : null;

      positions.push({
        tokenAddress: token.contractAddress,
        chain: 'evm',
        symbol: token.symbol,
        name: token.name,
        logoUrl: token.logoUrl,
        quantity,
        costBasisUsd: remainingCostBasisUsd,
        currentPriceUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct,
        feesUsd: Math.min(remainingFeesUsd, remainingCostBasisUsd),
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

/** Kamby's USDC fee (trade fee + new-coin setup) on each Solana buy, in dollars: what the user
 *  paid minus what was swapped (both USDC, 6 decimals); the platform fee alone for older quotes
 *  that didn't record the total. */
async function solanaBuyFees(transactionIds: string[]): Promise<Map<string, number>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await prisma.solanaTradeTransaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, quote: { select: { inputAmount: true, platformFeeAmount: true, unsignedTx: true } } },
  });
  const fees = new Map<string, number>();
  for (const row of rows) {
    const totalPaidRaw = (row.quote.unsignedTx as { totalPaidRaw?: unknown } | null)?.totalPaidRaw;
    const fee =
      typeof totalPaidRaw === 'string' && /^\d+$/.test(totalPaidRaw) && /^\d+$/.test(row.quote.inputAmount)
        ? Number(BigInt(totalPaidRaw) - BigInt(row.quote.inputAmount)) / 1e6
        : Number(row.quote.platformFeeAmount || '0') / 1e6;
    fees.set(row.id, Number.isFinite(fee) && fee > 0 ? fee : 0);
  }
  return fees;
}

/** Each EVM buy's fee rate in basis points. */
async function evmBuyFeeBps(transactionIds: string[]): Promise<Map<string, number>> {
  if (transactionIds.length === 0) return new Map();
  const rows = await prisma.tradeTransaction.findMany({
    where: { id: { in: transactionIds } },
    select: { id: true, quote: { select: { platformFeeBps: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.quote.platformFeeBps]));
}
