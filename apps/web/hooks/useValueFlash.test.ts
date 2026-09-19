import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useValueFlash } from './useValueFlash';

describe('useValueFlash', () => {
  it('reports no flash on the initial render', () => {
    const { result } = renderHook(() => useValueFlash(50));
    expect(result.current).toBeNull();
  });

  it('flashes "up" when the value increases between renders', () => {
    const { result, rerender } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: 50 },
    });
    rerender({ value: 51 });
    expect(result.current).toBe('up');
  });

  it('flashes "down" when the value decreases between renders', () => {
    const { result, rerender } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: 50 },
    });
    rerender({ value: 49 });
    expect(result.current).toBe('down');
  });

  it('never flashes when the value is unchanged', () => {
    const { result, rerender } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: 50 },
    });
    rerender({ value: 50 });
    expect(result.current).toBeNull();
  });

  it('never flashes across a null value in either direction', () => {
    const { result, rerender } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: null as number | null },
    });
    rerender({ value: 50 });
    expect(result.current).toBeNull();

    const { result: result2, rerender: rerender2 } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: 50 as number | null },
    });
    rerender2({ value: null });
    expect(result2.current).toBeNull();
  });

  it('never flashes across a non-finite value', () => {
    const { result, rerender } = renderHook(({ value }) => useValueFlash(value), {
      initialProps: { value: 50 },
    });
    rerender({ value: Number.NaN });
    expect(result.current).toBeNull();
  });

  it('clears the flash after the given duration', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ value }) => useValueFlash(value, 700), {
        initialProps: { value: 50 },
      });
      rerender({ value: 51 });
      expect(result.current).toBe('up');

      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
