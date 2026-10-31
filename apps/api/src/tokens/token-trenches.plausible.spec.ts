import { isPlausibleCurve } from './token-trenches.service';

describe('isPlausibleCurve', () => {
  it('keeps real curves and drops misread accounts', () => {
    expect(isPlausibleCurve('84000000000')).toBe(true); // 84 SOL, about to graduate
    expect(isPlausibleCurve('0')).toBe(true);
    expect(isPlausibleCurve('17299467970966795224')).toBe(false);
    expect(isPlausibleCurve('40275992086090')).toBe(false); // 40,275 SOL
    expect(isPlausibleCurve('not a number')).toBe(false);
  });
});
