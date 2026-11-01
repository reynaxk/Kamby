import { eventDrafts, eventOutcome } from './polymarket-events';

const now = Date.parse('2026-11-01T06:00:00Z');
const market = (id: string, question: string, extra: Record<string, unknown> = {}) => ({
  id,
  question,
  outcomes: '["Yes", "No"]',
  outcomePrices: '["0.4", "0.6"]',
  endDate: '2026-11-04T04:59:00Z',
  volume24hr: 10,
  ...extra,
});

describe('polymarket events', () => {
  it('asks one open, undecided, near-term question per event — no violence, no odds', () => {
    const drafts = eventDrafts(
      [
        { id: 'e1', title: 'House 2026', markets: [market('1', 'Will Democrats win the House?'), market('2', 'Will Republicans win the House?', { volume24hr: 99 })] },
        { id: 'e2', title: 'Decided', markets: [market('3', 'Done?', { outcomePrices: '["0.99", "0.01"]' })] },
        { id: 'e3', title: 'Far', markets: [market('4', 'Will X win in 2028?', { endDate: '2028-11-08T04:59:00Z' })] },
        { id: 'e4', title: 'Will country A strike country B?', markets: [market('5', 'Strike by Friday?')] },
      ],
      'politics',
      now,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ title: 'Will Republicans win the House?', options: ['Yes', 'No'], category: 'politics', dedupeKey: 'event:2', meta: { marketId: '2' } });
    expect(JSON.stringify(drafts[0])).not.toContain('0.6');
  });

  it('resolves only once the market has settled', () => {
    expect(eventOutcome({ id: '1', question: '', outcomes: '[]', closed: false, outcomePrices: '["1","0"]' })).toBeNull();
    expect(eventOutcome({ id: '1', question: '', outcomes: '[]', closed: true, outcomePrices: '["0","1"]' })).toBe(1);
  });
});
