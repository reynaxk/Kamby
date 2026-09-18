import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchBar } from './SearchBar';

describe('SearchBar', () => {
  it('shows the current search term as the input value', () => {
    render(<SearchBar defaultValue="WBNB" />);
    expect(screen.getByRole('textbox')).toHaveValue('WBNB');
  });

  it('shows an empty box when there is no active search', () => {
    render(<SearchBar />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  // Real bug fixed 2026-09-17: `defaultValue` only applies once, on mount — a later render
  // with a different `defaultValue` (e.g. after navigating from a search back to the plain
  // Discover view) left the OLD term stuck in the box even though the page underneath it had
  // correctly changed. The `key={defaultValue}` fix forces a fresh input whenever the
  // server-known term changes, which this simulates via a rerender rather than real
  // navigation (that requires a browser, not jsdom).
  it('resets its visible value when defaultValue changes on rerender, rather than keeping the stale text', () => {
    const { rerender } = render(<SearchBar defaultValue="WBNB" />);
    expect(screen.getByRole('textbox')).toHaveValue('WBNB');

    rerender(<SearchBar defaultValue={undefined} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('resets to the new term (not the old one) when defaultValue changes to a different search', () => {
    const { rerender } = render(<SearchBar defaultValue="WBNB" />);
    rerender(<SearchBar defaultValue="cbBTC" />);
    expect(screen.getByRole('textbox')).toHaveValue('cbBTC');
  });
});
