import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { DISCOVERY_RANKING } from '@kamby/domain';
import { SafetyService } from './safety.service';

jest.mock('@kamby/db', () => ({
  prisma: {
    tokenMarket: {
      findFirst: jest.fn(),
    },
  },
}));

const mockedPrisma = jest.mocked(prisma, { shallow: true });

function baseMarket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'market-1',
    liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd + 1,
    lastPriceUpdateAt: new Date(),
    priceUsd: '1.5',
    token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 },
    quoteToken: { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'WETH', decimals: 18 },
    ...overrides,
  };
}

describe('SafetyService', () => {
  const safety = new SafetyService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the market when liquidity, decimals, and price freshness all pass', async () => {
    const market = baseMarket();
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(market);

    const result = await safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453);

    expect(result).toBe(market);
  });

  it('rejects a token address with no tracked market', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      safety.assertTradable('0xcccccccccccccccccccccccccccccccccccccccc', 8453),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a market whose token decimals are unknown', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ token: { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: null } }),
    );

    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market with no tracked liquidity at all', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(baseMarket({ liquidityUsd: null }));

    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market below the minimum liquidity gate', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ liquidityUsd: DISCOVERY_RANKING.minLiquidityUsd - 1 }),
    );

    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a market with a stale price snapshot', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(
      baseMarket({ lastPriceUpdateAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }),
    );

    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('looks up the market by base-token address case-insensitively, filtered via the chain relation', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockResolvedValue(baseMarket());

    await safety.assertTradable('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 8453);

    // chain: { identifier: 'eip155:8453' }, not chainId: 8453 — TokenMarket.chainId is
    // Chain's own internal autoincrement row id, not the real numeric EVM chain id this
    // method receives. This exact mismatch was a real incident (2026-09-15): every quote
    // request for every EVM token was silently 404ing because this filter never matched
    // anything real. See identifierForChainId's own doc comment in @kamby/domain.
    expect(mockedPrisma.tokenMarket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chain: { identifier: 'eip155:8453' },
          token: { contractAddress: { equals: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mode: 'insensitive' } },
        },
      }),
    );
  });

  // TokenMarket is only unique per (chainId, contractAddress) — the same address is a real,
  // distinct market on two chains, so the chain filter must actually be honored by the
  // (mocked) query, not merely present in the call shape asserted above.
  it('resolves a same-address market to the chain that was actually requested, not whichever chain answers first', async () => {
    const baseChainMarket = baseMarket({ id: 'market-base' });
    const arbitrumChainMarket = baseMarket({ id: 'market-arbitrum' });
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockImplementation(
      async ({ where }: { where: { chain: { identifier: string } } }) =>
        where.chain.identifier === 'eip155:8453'
          ? baseChainMarket
          : where.chain.identifier === 'eip155:42161'
            ? arbitrumChainMarket
            : null,
    );

    const base = await safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 8453);
    const arbitrum = await safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 42161);

    expect(base.id).toBe('market-base');
    expect(arbitrum.id).toBe('market-arbitrum');
  });

  it('404s for a chain that has no market at this address, even though another chain does', async () => {
    (mockedPrisma.tokenMarket.findFirst as jest.Mock).mockImplementation(
      async ({ where }: { where: { chain: { identifier: string } } }) =>
        where.chain.identifier === 'eip155:8453' ? baseMarket() : null,
    );

    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 42161),
    ).rejects.toThrow(NotFoundException);
  });

  it('404s for an unconfigured chain id rather than querying with a meaningless filter', async () => {
    await expect(
      safety.assertTradable('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 999_999),
    ).rejects.toThrow(NotFoundException);
    expect(mockedPrisma.tokenMarket.findFirst).not.toHaveBeenCalled();
  });
});
