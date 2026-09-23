import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TraderTokenStat } from '@kamby/domain';
import { TraderTokensList } from './TraderTokensList';

function fakeEntry(overrides: Partial<TraderTokenStat> = {}): TraderTokenStat {
  return {
    token: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', name: 'Foo Token', logoUrl: null },
    tradeCount: 5,
    volumeUsd: 25_000,
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TraderTokensList', () => {
  it('shows a real empty state, not a blank list, when the trader has traded nothing', () => {
    render(<TraderTokensList tokens={[]} />);
    expect(screen.getByText('No tokens traded yet.')).toBeInTheDocument();
  });

  it('links every token to a real /market/base/{address} URL — a documented, deliberate gap (TraderTokenStat carries no chain info yet), not a bug', () => {
    render(<TraderTokensList tokens={[fakeEntry({ token: { address: '0xaaa', symbol: 'FOO', name: 'Foo', logoUrl: null } })]} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/market/base/0xaaa');
  });

  it("wires each row to its own real token's trade count and volume, not a shared value", () => {
    render(
      <TraderTokensList
        tokens={[
          fakeEntry({ token: { address: '0xaaa', symbol: 'FIRST', name: null, logoUrl: null }, tradeCount: 3, volumeUsd: 1_000 }),
          fakeEntry({ token: { address: '0xbbb', symbol: 'SECOND', name: null, logoUrl: null }, tradeCount: 9, volumeUsd: 2_000 }),
        ]}
      />,
    );
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    expect(screen.getByText('SECOND')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('$1.0K')).toBeInTheDocument();
    expect(screen.getByText('$2.0K')).toBeInTheDocument();
  });
});
