import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TopTrader } from '@kamby/domain';
import { TopTraders } from './TopTraders';

function fakeTrader(overrides: Partial<TopTrader> = {}): TopTrader {
  return {
    address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    username: null,
    avatarUrl: null,
    volumeUsd: 50_000,
    tradeCount: 12,
    ...overrides,
  };
}

describe('TopTraders', () => {
  it('renders no cards for an empty list, no crash', () => {
    const { container } = render(<TopTraders traders={[]} />);
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it("links each trader's card to their own real profile, not a shared/generic URL", () => {
    render(<TopTraders traders={[fakeTrader({ address: '0xaaa' }), fakeTrader({ address: '0xbbb' })]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/trader/0xaaa', '/trader/0xbbb']);
  });

  it('shows each real trader\'s own volume and trade count, not a shared value across cards', () => {
    render(
      <TopTraders
        traders={[
          fakeTrader({ address: '0xaaa', volumeUsd: 1_500_000, tradeCount: 42 }),
          fakeTrader({ address: '0xbbb', volumeUsd: 3_000, tradeCount: 7 }),
        ]}
      />,
    );
    expect(screen.getByText('$1.50M')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('$3.0K')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });
});
