import type { Prisma } from '@kamby/db';
import {
  toSocialActivity,
  toTopTrader,
  toTraderProfile,
  toTraderStats,
  toTraderSummary,
  toTraderTokenStat,
  type ActivityRow,
  type WalletRow,
} from './social.mapper';

function fakeDecimal(n: number): Prisma.Decimal {
  return { toString: () => String(n), valueOf: () => n } as unknown as Prisma.Decimal;
}

function fakeActivityRow(overrides: Partial<Record<string, unknown>> = {}): ActivityRow {
  return {
    id: 'swap-1',
    chainId: 8453,
    traderAddress: '0xtrader',
    side: 'buy',
    priceUsd: fakeDecimal(2),
    volumeUsd: fakeDecimal(100),
    blockTimestamp: new Date('2026-01-01T00:00:00.000Z'),
    txHash: '0xabc',
    trader: { user: { username: 'alex', avatarUrl: 'a.png' } },
    tokenMarket: {
      chain: { identifier: 'eip155:8453' },
      token: { contractAddress: '0xtoken', symbol: 'FOO', name: 'Foo', logoUrl: null, decimals: 18 },
      quoteToken: { contractAddress: '0xquote', symbol: 'USDC', decimals: 6 },
    },
    ...overrides,
  } as unknown as ActivityRow;
}

function fakeWalletRow(overrides: Partial<Record<string, unknown>> = {}): WalletRow {
  return {
    address: '0xwallet',
    firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
    user: { username: 'alex', avatarUrl: 'a.png' },
    ...overrides,
  } as unknown as WalletRow;
}

describe('toSocialActivity', () => {
  it('maps side "buy"/"sell" to action "BUY"/"SELL"', () => {
    expect(toSocialActivity(fakeActivityRow({ side: 'buy' }), 0, null).action).toBe('BUY');
    expect(toSocialActivity(fakeActivityRow({ side: 'sell' }), 0, null).action).toBe('SELL');
  });

  it('derives tokenAmount as amountUsd / priceUsd', () => {
    const dto = toSocialActivity(fakeActivityRow({ priceUsd: fakeDecimal(2), volumeUsd: fakeDecimal(100) }), 0, null);
    expect(dto.amountUsd).toBe(100);
    expect(dto.priceUsd).toBe(2);
    expect(dto.tokenAmount).toBe(50);
  });

  it('falls back to tokenAmount 0 rather than dividing by zero if priceUsd is ever 0', () => {
    const dto = toSocialActivity(fakeActivityRow({ priceUsd: fakeDecimal(0) }), 0, null);
    expect(dto.tokenAmount).toBe(0);
  });

  it('resolves trader displayName/avatarUrl from the linked user, null when there is no trader row at all', () => {
    const withUser = toSocialActivity(fakeActivityRow({ trader: { user: { username: 'alex', avatarUrl: 'a.png' } } }), 0, null);
    expect(withUser.trader).toEqual({ address: '0xtrader', displayName: 'alex', avatarUrl: 'a.png' });

    const withoutTrader = toSocialActivity(fakeActivityRow({ trader: null }), 0, null);
    expect(withoutTrader.trader).toEqual({ address: '0xtrader', displayName: null, avatarUrl: null });
  });

  it('passes likes/likedByMe through untouched — batched by the caller, never queried per-row here', () => {
    const dto = toSocialActivity(fakeActivityRow(), 7, true);
    expect(dto.social).toEqual({ likes: 7, likedByMe: true });
  });

  it('carries the real chain identifier from the joined market, not a guessed default', () => {
    const dto = toSocialActivity(fakeActivityRow({ tokenMarket: { chain: { identifier: 'eip155:56' }, token: fakeActivityRow().tokenMarket.token, quoteToken: fakeActivityRow().tokenMarket.quoteToken } }), 0, null);
    expect(dto.chainIdentifier).toBe('eip155:56');
  });
});

describe('toTraderSummary', () => {
  it('resolves username/avatarUrl from the linked user', () => {
    expect(toTraderSummary(fakeWalletRow())).toEqual({ address: '0xwallet', username: 'alex', avatarUrl: 'a.png' });
  });

  it('falls back to null, never a fabricated placeholder, when there is no linked user', () => {
    expect(toTraderSummary(fakeWalletRow({ user: null }))).toEqual({ address: '0xwallet', username: null, avatarUrl: null });
  });
});

describe('toTraderStats', () => {
  const baseAgg = { totalSwaps: 10, buyCount: 6, sellCount: 4, volumeUsd: fakeDecimal(1000) };
  const baseExtra = { perTokenVolumeUsd: [600, 400], largestTradeUsd: fakeDecimal(300), recent24h: { tradeCount: 2, volumeUsd: fakeDecimal(150) } };

  it('computes avgTradeSizeUsd as volumeUsd / totalSwaps', () => {
    const stats = toTraderStats(fakeWalletRow(), baseAgg, null, baseExtra);
    expect(stats.avgTradeSizeUsd).toBe(100);
  });

  it('leaves avgTradeSizeUsd null — never a divide-by-zero — for a trader with zero swaps', () => {
    const stats = toTraderStats(fakeWalletRow(), { ...baseAgg, totalSwaps: 0 }, null, baseExtra);
    expect(stats.avgTradeSizeUsd).toBeNull();
  });

  it('treats a null volumeUsd as 0, not a fabricated or missing value', () => {
    const stats = toTraderStats(fakeWalletRow(), { ...baseAgg, volumeUsd: null }, null, baseExtra);
    expect(stats.volumeUsd).toBe(0);
  });

  it('treats a null recent24h.volumeUsd as 0 the same way', () => {
    const stats = toTraderStats(fakeWalletRow(), baseAgg, null, { ...baseExtra, recent24h: { tradeCount: 0, volumeUsd: null } });
    expect(stats.volume24hUsd).toBe(0);
  });

  it('derives uniqueTokensTraded from the length of the per-token volume breakdown', () => {
    const stats = toTraderStats(fakeWalletRow(), baseAgg, null, baseExtra);
    expect(stats.uniqueTokensTraded).toBe(2);
  });

  it('leaves lastActiveAt null when the trader has never had a swap indexed, ISO-formats it when they have', () => {
    const never = toTraderStats(fakeWalletRow(), baseAgg, null, baseExtra);
    expect(never.lastActiveAt).toBeNull();

    const recently = toTraderStats(fakeWalletRow(), baseAgg, new Date('2026-01-02T00:00:00.000Z'), baseExtra);
    expect(recently.lastActiveAt).toBe('2026-01-02T00:00:00.000Z');
  });
});

describe('toTraderTokenStat', () => {
  const fakeTokenMarket = { token: { contractAddress: '0xtoken', symbol: 'FOO', name: 'Foo', logoUrl: null } };

  it('accepts either a Prisma.Decimal or a plain number for volumeUsd and normalizes both to a number', () => {
    const fromDecimal = toTraderTokenStat(fakeTokenMarket, 3, fakeDecimal(250), new Date('2026-01-01T00:00:00.000Z'));
    expect(fromDecimal.volumeUsd).toBe(250);

    const fromNumber = toTraderTokenStat(fakeTokenMarket, 3, 250, new Date('2026-01-01T00:00:00.000Z'));
    expect(fromNumber.volumeUsd).toBe(250);
  });

  it('ISO-formats lastActivityAt', () => {
    const stat = toTraderTokenStat(fakeTokenMarket, 3, 250, new Date('2026-03-15T12:00:00.000Z'));
    expect(stat.lastActivityAt).toBe('2026-03-15T12:00:00.000Z');
  });
});

describe('toTopTrader', () => {
  it('resolves username/avatarUrl from the wallet when present', () => {
    const top = toTopTrader('0xwallet', fakeWalletRow(), 5000, 12);
    expect(top).toEqual({ address: '0xwallet', username: 'alex', avatarUrl: 'a.png', volumeUsd: 5000, tradeCount: 12 });
  });

  it('falls back to null username/avatarUrl when the wallet row is undefined entirely (a top trader with no linked Wallet row yet)', () => {
    const top = toTopTrader('0xwallet', undefined, 5000, 12);
    expect(top).toEqual({ address: '0xwallet', username: null, avatarUrl: null, volumeUsd: 5000, tradeCount: 12 });
  });
});

describe('toTraderProfile', () => {
  it('assembles the full profile from its already-computed parts without recomputing any of them', () => {
    const stats = toTraderStats(fakeWalletRow(), { totalSwaps: 1, buyCount: 1, sellCount: 0, volumeUsd: fakeDecimal(10) }, null, {
      perTokenVolumeUsd: [10],
      largestTradeUsd: fakeDecimal(10),
      recent24h: { tradeCount: 1, volumeUsd: fakeDecimal(10) },
    });

    const profile = toTraderProfile(fakeWalletRow(), stats, 3, 5, true, null);

    expect(profile).toEqual({
      address: '0xwallet',
      username: 'alex',
      avatarUrl: 'a.png',
      stats,
      followerCount: 3,
      followingCount: 5,
      isFollowedByMe: true,
      realizedPnl: null,
    });
  });
});
