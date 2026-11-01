import { predictionShares, type NarrativesSnapshot, type NarrativeToken } from '@kamby/domain';
import { draftPolls, draftStem, resolveByPrice, usd } from './predictions-cron.service';
import { toPrediction } from './predictions.service';

const token = (symbol: string, address: string, price: number, liquidityUsd: number, heat: number): NarrativeToken => ({
  chainIdentifier: 'solana',
  tokenAddress: address,
  symbol,
  name: symbol,
  logoUrl: null,
  priceUsd: price,
  change1hPct: 1,
  change24hPct: 2,
  volume1hUsd: 100,
  volume24hUsd: 1000,
  liquidityUsd,
  marketCapUsd: 1e7,
  spark: [],
  heat,
});

const snapshot = {
  atIso: '',
  narratives: [
    { id: 'dogs', name: 'Dog Coins', emoji: '🐶', heat: 90, tokens: [token('BONK', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 0.00002, 5e6, 80), token('WIF', 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 1.2, 8e6, 70), token('PUP', 'Pup1pump', 0.01, 1e4, 60)] },
    { id: 'defi', name: 'DeFi', emoji: '🏦', heat: 40, tokens: [] },
    { id: 'majors', name: 'Majors', emoji: '💎', heat: 20, tokens: [] },
  ],
} as unknown as NarrativesSnapshot;

describe('predictions', () => {
  it('splits votes into whole percents that add to 100', () => {
    expect(predictionShares([1, 1, 1])).toEqual([34, 33, 33]);
    expect(predictionShares([72, 28])).toEqual([72, 28]);
    expect(predictionShares([0, 0])).toEqual([0, 0]);
  });

  it('asks many different polls from real data — one per template per coin, never about a thin coin', () => {
    const drafts = draftPolls(snapshot, [], '42');
    expect(drafts[0]!.title).toBe(`Will $BONK be above ${usd(0.000021)} in 12 hours?`);
    expect(drafts.map((d) => d.kind)).toEqual(expect.arrayContaining(['BINARY', 'OVER_UNDER', 'RANGES', 'MULTI_CHOICE']));
    expect(drafts.some((d) => d.title.includes('$WIF vs') || d.title.includes('$BONK vs $WIF'))).toBe(true);
    expect(drafts.some((d) => d.title.includes('$PUP') && d.kind !== 'MULTI_CHOICE')).toBe(false); // $10K pool: too thin to ask about
    expect(new Set(drafts.map((d) => draftStem(d.dedupeKey))).size).toBe(drafts.length);
    expect(draftStem(drafts[0]!.dedupeKey)).not.toContain('42');
  });

  it('resolves price polls from the price at the end', () => {
    expect(resolveByPrice({ resolutionType: 'PRICE_TARGET', meta: { threshold: 10 } }, 11)).toBe(0);
    expect(resolveByPrice({ resolutionType: 'PRICE_TARGET', meta: { threshold: 10 } }, 9)).toBe(1);
    expect(resolveByPrice({ resolutionType: 'PRICE_TARGET', meta: { threshold: 10, below: true } }, 9)).toBe(0);
    expect(resolveByPrice({ resolutionType: 'PRICE_RANGE', meta: { bounds: [9, 11] } }, 10)).toBe(1);
    expect(resolveByPrice({ resolutionType: 'PRICE_RANGE', meta: { bounds: [9, 11] } }, 12)).toBe(2);
    expect(resolveByPrice({ resolutionType: 'MANUAL', meta: {} }, 12)).toBeNull();
  });

  it('shows a past-due open poll as expired', () => {
    const row = {
      id: 'p1', title: 'Q', category: 'memes', kind: 'BINARY', options: ['Yes', 'No'], status: 'ACTIVE', resolutionType: 'PRICE_TARGET', source: 'AUTO_PRICE',
      chainIdentifier: null, tokenAddress: null, meta: { threshold: 2 }, expiresAt: new Date(Date.now() - 1000), resolvedOptionIndex: null, resolvedAt: null,
      createdByUserId: null, liveRoomId: null, dedupeKey: null, createdAt: new Date(),
    };
    const p = toPrediction(row, [3, 1], { myVote: 0, onAir: new Set(), hosts: new Map() });
    expect(p.status).toBe('EXPIRED');
    expect(p.total).toBe(4);
    expect(p.thresholdUsd).toBe(2);
  });
});
