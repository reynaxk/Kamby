import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { leadingZeros, PriceText } from './PriceText';

describe('PriceText', () => {
  it('counts the zeros after "0."', () => {
    expect(leadingZeros(0.00000341)).toBe(5);
    expect(leadingZeros(0.0012)).toBe(2);
    expect(leadingZeros(1.5)).toBe(0);
  });

  it('writes tiny prices with a subscript zero count, normal ones as before', () => {
    expect(render(<PriceText value={0.00000341} />).container.textContent).toBe('$0.05341');
    expect(render(<PriceText value={0.0000099999} />).container.textContent).toBe('$0.041');
    expect(render(<PriceText value={1.5} />).container.textContent).toBe('$1.50');
    expect(render(<PriceText value={null} />).container.textContent).toBe('—');
  });
});
