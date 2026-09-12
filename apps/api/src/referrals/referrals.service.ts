import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { REFERRAL_SHARE_BPS, calculateFeeAmount, type ReferralSummaryDto } from '@kamby/domain';
import { formatUnits } from 'viem';

/** USDC's own decimals — referral earnings are only ever computed in USDC, see
 *  docs/REFERRALS.md#currency-scope and the ReferralSummarySchema doc comment. Not read
 *  from config: this is a display-formatting constant about USDC itself (always 6
 *  decimals, unlike the platform's configurable USDC_CONTRACT_ADDRESS), not something a
 *  deploy should be able to change. */
const USDC_DECIMALS = 6;

/**
 * Phase 7 — see docs/REFERRALS.md. A referrer's earned total is *computed*, never stored
 * as a mutable balance: it's always derived fresh from CONFIRMED trades by users they
 * referred, so it can never drift from the trades that actually justify it and never needs
 * a reconciliation job. Nothing here moves funds — see the module doc comment on
 * packages/domain/src/referral.ts for why that's deliberate, not a missing feature.
 */
@Injectable()
export class ReferralsService {
  async getMySummary(userId: string): Promise<ReferralSummaryDto> {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (!user) throw new NotFoundException('No such user');

    const [referredCount, feeRows] = await Promise.all([
      prisma.user.count({ where: { referredByUserId: userId } }),
      // Only CONFIRMED trades, and only ones whose fee was collected through the
      // guaranteed-USDC-fee flow (quote.feeUnsignedTx set) — see
      // docs/TRADING.md#guaranteed-usdc-fees and this file's module comment for why a
      // trade whose fee rode a non-USDC-quoted market's aggregator-embedded cut is
      // deliberately excluded rather than summed as if it were the same currency.
      prisma.tradeTransaction.findMany({
        where: {
          status: 'CONFIRMED',
          user: { referredByUserId: userId },
          quote: { feeUnsignedTx: { not: Prisma.JsonNull } },
        },
        select: { platformFeeAmount: true },
      }),
    ]);

    const totalFeesRaw = feeRows.reduce((sum, row) => sum + BigInt(row.platformFeeAmount), 0n);
    const earnedRaw = calculateFeeAmount(totalFeesRaw, REFERRAL_SHARE_BPS);

    return {
      referralCode: user.referralCode,
      referredCount,
      earnedUsdcAmountRaw: earnedRaw.toString(),
      earnedUsdcAmountFormatted: formatUnits(earnedRaw, USDC_DECIMALS),
    };
  }
}
