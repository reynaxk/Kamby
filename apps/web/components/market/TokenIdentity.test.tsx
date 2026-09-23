import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TokenIdentity } from './TokenIdentity';

describe('TokenIdentity', () => {
  it('shows the real symbol as the primary line when one exists', () => {
    render(<TokenIdentity symbol="FOO" name="Foo Token" logoUrl={null} />);
    expect(screen.getByText('FOO')).toBeInTheDocument();
  });

  it('falls back to an em dash for the primary line when there is no symbol at all', () => {
    render(<TokenIdentity symbol={null} name="Foo Token" logoUrl={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the name as a secondary line only when one exists', () => {
    render(<TokenIdentity symbol="FOO" name="Foo Token" logoUrl={null} />);
    expect(screen.getByText('Foo Token')).toBeInTheDocument();
  });

  it('never shows a secondary line when there is no name', () => {
    const { container } = render(<TokenIdentity symbol="FOO" name={null} logoUrl={null} />);
    // The name line is the only element styled with these classes — confirm it's absent
    // entirely, not just empty, rather than relying on a brittle structural element count.
    expect(container.querySelector('.text-ink-400')).not.toBeInTheDocument();
  });

  it('computes initials from the symbol when one exists', () => {
    render(<TokenIdentity symbol="FOO" name="Foo Token" logoUrl={null} />);
    expect(screen.getByText('FO')).toBeInTheDocument();
  });

  it('falls back to initials from the name when there is no symbol', () => {
    render(<TokenIdentity symbol={null} name="Baz Token" logoUrl={null} />);
    expect(screen.getByText('BA')).toBeInTheDocument();
  });

  it('falls back to a bare "?" initial when neither symbol nor name exists', () => {
    render(<TokenIdentity symbol={null} name={null} logoUrl={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('renders a real logo image, not initials, when logoUrl is present', () => {
    const { container } = render(<TokenIdentity symbol="FOO" name="Foo Token" logoUrl="https://example.com/logo.png" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/logo.png');
    expect(screen.queryByText('FO')).not.toBeInTheDocument();
  });

  it('applies the correct dimension classes for each size, defaulting to md', () => {
    const { container: sm } = render(<TokenIdentity symbol="FOO" name={null} logoUrl={null} size="sm" />);
    expect(sm.querySelector('[aria-hidden]')).toHaveClass('h-7', 'w-7');

    const { container: md } = render(<TokenIdentity symbol="FOO" name={null} logoUrl={null} />);
    expect(md.querySelector('[aria-hidden]')).toHaveClass('h-9', 'w-9');

    const { container: lg } = render(<TokenIdentity symbol="FOO" name={null} logoUrl={null} size="lg" />);
    expect(lg.querySelector('[aria-hidden]')).toHaveClass('h-11', 'w-11');
  });
});
