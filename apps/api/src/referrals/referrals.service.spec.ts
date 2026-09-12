import { NotFoundException } from '@nestjs/common';
import { Prisma, prisma } from '@kamby/db';
import { REFERRAL_SHARE_BPS } from '@kamby/domain';
import { parseUnits } from 'viem';
import { ReferralsService } from './referrals.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      user: { findUnique: jest.fn(), count: jest.fn() },
      tradeTransaction: { findMany: jest.fn() },
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });
const USER_ID = 'user-1';

describe('ReferralsService', () => {
  const service = new ReferralsService();

  beforeEach(() => {
    jest.clearAllMocks();
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ referralCode: 'ABCD2345' });
    (mockedPrisma.user.count as jest.Mock).mockResolvedValue(0);
    (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('404s for a user that does not exist', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.getMySummary(USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns the caller\'s own referral code and referred count', async () => {
    (mockedPrisma.user.findUnique as jest.Mock).mockResolvedValue({ referralCode: 'XYZQ9988' });
    (mockedPrisma.user.count as jest.Mock).mockResolvedValue(7);

    const summary = await service.getMySummary(USER_ID);

    expect(summary.referralCode).toBe('XYZQ9988');
    expect(summary.referredCount).toBe(7);
    expect(mockedPrisma.user.count).toHaveBeenCalledWith({ where: { referredByUserId: USER_ID } });
  });

  it('only ever queries CONFIRMED trades whose fee rode the guaranteed-USDC-fee flow, for referred users only', async () => {
    await service.getMySummary(USER_ID);

    expect(mockedPrisma.tradeTransaction.findMany).toHaveBeenCalledWith({
      where: {
        status: 'CONFIRMED',
        user: { referredByUserId: USER_ID },
        quote: { feeUnsignedTx: { not: Prisma.JsonNull } },
      },
      select: { platformFeeAmount: true },
    });
  });

  it('is an honest zero, not an error, when there are no qualifying trades yet', async () => {
    const summary = await service.getMySummary(USER_ID);

    expect(summary.earnedUsdcAmountRaw).toBe('0');
    expect(summary.earnedUsdcAmountFormatted).toBe('0');
  });

  it('computes the earned total as exactly REFERRAL_SHARE_BPS of the summed platform fees, using bigint math', async () => {
    const feeA = parseUnits('1', 6); // 1 USDC
    const feeB = parseUnits('2.5', 6); // 2.5 USDC
    (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([
      { platformFeeAmount: feeA.toString() },
      { platformFeeAmount: feeB.toString() },
    ]);

    const summary = await service.getMySummary(USER_ID);

    const expectedTotal = feeA + feeB; // 3.5 USDC total platform fees
    const expectedEarned = (expectedTotal * BigInt(REFERRAL_SHARE_BPS)) / 10_000n;
    expect(summary.earnedUsdcAmountRaw).toBe(expectedEarned.toString());
  });

  it('formats the earned total in USDC\'s own 6 decimals, never a JS number', async () => {
    (mockedPrisma.tradeTransaction.findMany as jest.Mock).mockResolvedValue([
      { platformFeeAmount: parseUnits('10', 6).toString() }, // 10 USDC in platform fees
    ]);

    const summary = await service.getMySummary(USER_ID);

    // 20% of 10 USDC = 2 USDC
    expect(summary.earnedUsdcAmountFormatted).toBe('2');
  });
});
