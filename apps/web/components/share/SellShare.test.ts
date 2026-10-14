import { describe, expect, it } from 'vitest';
import type { TokenPosition } from '@kamby/domain';
import { realizedShare } from './SellShare';

const held: TokenPosition = {
  tokenAddress: 'mint',
  chainIdentifier: 'solana',
  symbol: 'WIF',
  name: 'dogwifhat',
  logoUrl: null,
  quantity: 100,
  costBasisUsd: 50,
  currentPriceUsd: 1,
  currentValueUsd: 100,
  unrealizedPnlUsd: 50,
  unrealizedPnlPct: 100,
  feesUsd: 2,
};

describe('realizedShare', () => {
  it('compares what the sold half cost with what it sold for', () => {
    const share = realizedShare(held, 50, 60, 'mint');
    expect(share).toMatchObject({ pnlUsd: 35, investedUsd: 25, valueUsd: 60, currentPrice: 1.2, entryPrice: 0.48, chainName: 'Solana', sold: true });
    expect(share?.pnlPct).toBeCloseTo(140);
  });

  it('is null for a loss or without a position to compare with', () => {
    expect(realizedShare(held, 50, 20, 'mint')).toBeNull();
    expect(realizedShare(null, 50, 60, 'mint')).toBeNull();
  });
});
