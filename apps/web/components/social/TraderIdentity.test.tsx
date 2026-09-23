import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TraderIdentity } from './TraderIdentity';

const ADDRESS = '0x1234567890123456789012345678901234567890';

describe('TraderIdentity', () => {
  it('shows the truncated address as the label when there is no displayName', () => {
    render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} />);
    expect(screen.getByText('0x1234…7890')).toBeInTheDocument();
  });

  it('shows the real displayName as the label when one exists', () => {
    render(<TraderIdentity address={ADDRESS} displayName="whale1" avatarUrl={null} />);
    expect(screen.getByText('whale1')).toBeInTheDocument();
  });

  it('also shows the truncated address as a secondary line when a displayName exists — never just one or the other silently dropped', () => {
    render(<TraderIdentity address={ADDRESS} displayName="whale1" avatarUrl={null} />);
    expect(screen.getByText('whale1')).toBeInTheDocument();
    expect(screen.getByText('0x1234…7890')).toBeInTheDocument();
  });

  it('never shows the secondary address line when there is no displayName — the label already is the address', () => {
    render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} />);
    expect(screen.getAllByText('0x1234…7890')).toHaveLength(1);
  });

  it('computes initials from the displayName when one exists, not the address', () => {
    render(<TraderIdentity address={ADDRESS} displayName="whale1" avatarUrl={null} />);
    expect(screen.getByText('WH')).toBeInTheDocument();
  });

  it('computes initials from the address (after stripping the 0x prefix) when there is no displayName', () => {
    // Without stripping "0x" first, every wallet with no displayName would show the same
    // "0X" initials regardless of its real address — the first 2 real hex characters are
    // what should show instead.
    render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders a real avatar image, not initials, when avatarUrl is present', () => {
    const { container } = render(
      <TraderIdentity address={ADDRESS} displayName="whale1" avatarUrl="https://example.com/a.png" />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png');
    expect(screen.queryByText('WH')).not.toBeInTheDocument();
  });

  it('applies the correct dimension classes for each size, defaulting to md', () => {
    const { container: sm } = render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} size="sm" />);
    expect(sm.querySelector('[aria-hidden]')).toHaveClass('h-7', 'w-7');

    const { container: md } = render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} />);
    expect(md.querySelector('[aria-hidden]')).toHaveClass('h-9', 'w-9');

    const { container: lg } = render(<TraderIdentity address={ADDRESS} displayName={null} avatarUrl={null} size="lg" />);
    expect(lg.querySelector('[aria-hidden]')).toHaveClass('h-11', 'w-11');
  });
});
