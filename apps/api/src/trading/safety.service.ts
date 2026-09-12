import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import type { Prisma } from '@kamby/db';
import { DISCOVERY_RANKING, isPriceStale, normalizeEvmAddress } from '@kamby/domain';

export type TradableMarket = Prisma.TokenMarketGetPayload<{
  include: { token: true; quoteToken: true; chain: true };
}>;

/**
 * Gatekeeps which markets Phase 3 will quote/trade at all — see
 * docs/TRADING.md#token-safety and #chain-scope. Trading is scoped to markets Kamby already
 * tracks (a token page only exists for one of these), so "does this token exist / have a
 * route / have liquidity" reduces to "is it one of our tracked markets, in good standing" —
 * reusing Phase 1's own discovery gates (`DISCOVERY_RANKING.minLiquidityUsd`,
 * `isPriceStale`) rather than inventing a parallel safety system. Never claims a token is
 * "safe" — see `SAFETY_DISCLAIMER` in packages/domain/src/trading.ts.
 */
@Injectable()
export class SafetyService {
  /**
   * `chainId` is a required, explicit parameter — never defaulted inside this service — so
   * there is exactly one place (the caller) where "which chain" gets decided. Since
   * `TokenMarket` is only unique per `(chainId, contractAddress)`, the same address can be a
   * real, distinct market on two chains; omitting this filter would let `orderBy(liquidityUsd)`
   * silently pick whichever chain's market happens to have more liquidity, and this method's
   * whole job is gatekeeping what gets priced and traded.
   */
  async assertTradable(tokenAddress: string, chainId: number): Promise<TradableMarket> {
    const normalized = normalizeEvmAddress(tokenAddress);
    const market = await prisma.tokenMarket.findFirst({
      where: { chainId, token: { contractAddress: { equals: normalized, mode: 'insensitive' } } },
      include: { token: true, quoteToken: true, chain: true },
      orderBy: { liquidityUsd: 'desc' },
    });
    if (!market) throw new NotFoundException(`"${tokenAddress}" is not a tracked, tradable market`);
    if (market.token.decimals === null || market.quoteToken.decimals === null) {
      throw new UnprocessableEntityException(`Token decimals unknown for "${tokenAddress}" — cannot trade it yet`);
    }
    if (market.liquidityUsd === null || Number(market.liquidityUsd) < DISCOVERY_RANKING.minLiquidityUsd) {
      throw new UnprocessableEntityException('This market does not have enough tracked liquidity to trade safely');
    }
    if (isPriceStale(market.lastPriceUpdateAt)) {
      throw new UnprocessableEntityException('Price data for this market is stale — try again shortly');
    }

    return market;
  }
}
