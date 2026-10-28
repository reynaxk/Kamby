import { describe, expect, it } from 'vitest';
import { applyNumpadKey } from './Numpad';

describe('applyNumpadKey', () => {
  it('types dollars and cents, one point, no leading zero, delete works', () => {
    expect(applyNumpadKey('', '5')).toBe('5');
    expect(applyNumpadKey('0', '7')).toBe('7');
    expect(applyNumpadKey('', '.')).toBe('0.');
    expect(applyNumpadKey('2.5', '.')).toBe('2.5');
    expect(applyNumpadKey('2.55', '9')).toBe('2.55');
    expect(applyNumpadKey('1234567', '8')).toBe('1234567');
    expect(applyNumpadKey('25', 'back')).toBe('2');
  });
});
