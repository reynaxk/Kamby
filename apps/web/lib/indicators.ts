import type { Candle } from '@kamby/domain';
import { ADX, ATR, AwesomeOscillator, BollingerBands } from 'technicalindicators';

/**
 * Pure indicator math over whatever candles a caller already has (KambyChart's own
 * `candles` prop — never a separate fetch). `technicalindicators`'s `calculate()`
 * functions all return an array shorter than the input (missing the first `period - 1`
 * warm-up values, where there isn't enough history yet to produce a real number) and
 * aligned to the *end* of the input — `alignToCandles` below is the one place that offset
 * gets applied, so every indicator here reports a real value against its real candle, never
 * a value silently shifted onto the wrong timestamp.
 */

export type OscillatorIndicatorId = 'atr' | 'adx' | 'awesome-oscillator';
export type IndicatorId = 'bollinger' | 'period-high-low' | OscillatorIndicatorId;

export const OSCILLATOR_IDS: readonly OscillatorIndicatorId[] = ['atr', 'adx', 'awesome-oscillator'];

export interface TimedValue {
  time: number;
  value: number;
}

function toUnixSeconds(bucketStart: string): number {
  return Math.floor(new Date(bucketStart).getTime() / 1000);
}

function alignToCandles<T>(candles: Candle[], output: T[]): { time: number; value: T }[] {
  const offset = candles.length - output.length;
  return output.map((value, i) => ({ time: toUnixSeconds(candles[offset + i]!.bucketStart), value }));
}

export interface BollingerBandsSeries {
  upper: TimedValue[];
  middle: TimedValue[];
  lower: TimedValue[];
}

export function computeBollingerBands(candles: Candle[], period = 20, stdDev = 2): BollingerBandsSeries {
  const output = BollingerBands.calculate({ period, stdDev, values: candles.map((c) => c.close) });
  const aligned = alignToCandles(candles, output);
  return {
    upper: aligned.map((a) => ({ time: a.time, value: a.value.upper })),
    middle: aligned.map((a) => ({ time: a.time, value: a.value.middle })),
    lower: aligned.map((a) => ({ time: a.time, value: a.value.lower })),
  };
}

export function computeAtr(candles: Candle[], period = 14): TimedValue[] {
  const output = ATR.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
  });
  return alignToCandles(candles, output).map((a) => ({ time: a.time, value: a.value }));
}

/** The `adx` line only — `technicalindicators` also returns `pdi`/`mdi` (the two
 *  directional-movement lines ADX is itself derived from) but a bare ADX overlay is the
 *  standard, recognizable reading of "add ADX" (trend strength, 0-100), not the fuller
 *  3-line DMI system. */
export function computeAdx(candles: Candle[], period = 14): TimedValue[] {
  const output = ADX.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    close: candles.map((c) => c.close),
    period,
  });
  return alignToCandles(candles, output).map((a) => ({ time: a.time, value: a.value.adx }));
}

export function computeAwesomeOscillator(candles: Candle[], fastPeriod = 5, slowPeriod = 34): TimedValue[] {
  const output = AwesomeOscillator.calculate({
    high: candles.map((c) => c.high),
    low: candles.map((c) => c.low),
    fastPeriod,
    slowPeriod,
  });
  return alignToCandles(candles, output).map((a) => ({ time: a.time, value: a.value }));
}

/**
 * High/low across whatever candle range is actually loaded — deliberately named "period",
 * not "52-week": `candles` is whatever timeframe/window the caller fetched (often far
 * shorter than a year), and labeling it "52-week" when it might be a week of hourly
 * candles would be a false claim, not just an approximation.
 */
export function computePeriodHighLow(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length === 0) return null;
  return { high: Math.max(...candles.map((c) => c.high)), low: Math.min(...candles.map((c) => c.low)) };
}
