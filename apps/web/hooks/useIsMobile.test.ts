import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useIsMobile } from './useIsMobile';

const originalMatchMedia = window.matchMedia;

/** A real, minimal MediaQueryList stub — supports the one thing this hook actually uses
 *  (`matches` plus `addEventListener('change', ...)`/removal), and exposes a way for the
 *  test itself to fire a real change event, the same shape a real viewport resize would. */
function stubMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    get matches() {
      return matches;
    },
    media: '',
    addEventListener: (_: 'change', listener: (e: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: 'change', listener: (e: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };
  window.matchMedia = () => mql as unknown as MediaQueryList;
  return {
    fireChange: (next: boolean) => {
      matches = next;
      listeners.forEach((l) => l({ matches: next } as MediaQueryListEvent));
    },
    listenerCount: () => listeners.size,
  };
}

describe('useIsMobile', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('resolves to true once mounted on a viewport under the breakpoint', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('resolves to false once mounted on a viewport at or above the breakpoint', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('updates live when the viewport crosses the breakpoint after mount', () => {
    const stub = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      stub.fireChange(true);
    });
    expect(result.current).toBe(true);
  });

  it('removes its change listener on unmount, not leaking one per mounted instance', () => {
    const stub = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(stub.listenerCount()).toBe(1);

    unmount();
    expect(stub.listenerCount()).toBe(0);
  });
});
