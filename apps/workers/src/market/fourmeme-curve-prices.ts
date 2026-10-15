import { prisma } from '@kamby/db';
import type { Logger } from 'pino';
import { createPublicClient, http, parseAbi, type PublicClient } from 'viem';

const HELPER_3 = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const HELPER_ABI = parseAbi([
  'function getTokenInfo(address token) view returns (uint256 version, address tokenManager, address quote, uint256 lastPrice, uint256 tradingFeeRate, uint256 minTradingFee, uint256 launchTime, uint256 offers, uint256 maxOffers, uint256 funds, uint256 maxFunds, bool liquidityAdded)',
]);
/** Once a coin leaves its curve it's priced like Kamby's other aggregator coins (DexScreener) and
 *  traded through the aggregators — see aggregator-markets.ts. */
export const GRADUATED_DEX = 'agg:pancakeswap-v2';

/**
 * Four.meme coins created in Kamby's LaunchPad still on their bonding curve (2026-10-15): no market
 * feed prices them, so this reads each one's curve (Helper3.getTokenInfo) — price in BNB times
 * BNB's own price from Kamby's WBNB market — and, the moment one graduates to PancakeSwap, hands it
 * to the aggregator path. Runs on the BNB workers only.
 */
export class FourMemeCurvePrices {
  private readonly client: PublicClient;

  constructor(
    rpcUrl: string,
    private readonly logger: Logger,
  ) {
    this.client = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  }

  async refresh(): Promise<{ priced: number; graduated: number }> {
    const markets = await prisma.tokenMarket.findMany({ where: { dex: 'fourmeme' }, include: { token: true }, take: 200 });
    if (markets.length === 0) return { priced: 0, graduated: 0 };
    const wbnb = await prisma.tokenMarket.findFirst({
      where: { token: { contractAddress: { equals: WBNB, mode: 'insensitive' } }, priceUsd: { not: null } },
      orderBy: { liquidityUsd: 'desc' },
      select: { priceUsd: true },
    });
    const bnbUsd = wbnb?.priceUsd ? Number(wbnb.priceUsd) : null;
    let priced = 0;
    let graduated = 0;
    for (const m of markets) {
      try {
        const info = await this.client.readContract({ address: HELPER_3, abi: HELPER_ABI, functionName: 'getTokenInfo', args: [m.token.contractAddress as `0x${string}`] });
        const [, , , lastPrice, , , , , , funds, , liquidityAdded] = info;
        if (liquidityAdded) {
          await prisma.tokenMarket.update({ where: { id: m.id }, data: { dex: GRADUATED_DEX } });
          graduated += 1;
          this.logger.info({ token: m.token.contractAddress }, 'Four.meme coin graduated to PancakeSwap — now an aggregator market');
          continue;
        }
        if (bnbUsd === null) continue;
        const priceUsd = (Number(lastPrice) / 1e18) * bnbUsd;
        await prisma.tokenMarket.update({
          where: { id: m.id },
          data: { priceUsd, marketCapUsd: priceUsd * 1e9, liquidityUsd: (Number(funds) / 1e18) * bnbUsd, lastPriceUpdateAt: new Date() },
        });
        priced += 1;
      } catch (error) {
        this.logger.warn({ err: error, token: m.token.contractAddress }, 'Four.meme curve read failed — will retry');
      }
    }
    return { priced, graduated };
  }
}
