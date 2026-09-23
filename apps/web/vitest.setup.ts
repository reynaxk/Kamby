import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's own auto-cleanup only registers when it finds `afterEach` on
// globalThis, which requires Vitest's `globals: true`. This project imports test helpers
// explicitly instead (matching every other package's tests), so cleanup is wired here.
afterEach(() => {
  cleanup();
});

// jsdom doesn't implement matchMedia at all — every component that needs to know the
// viewport (useIsMobile.ts) would otherwise throw in any test that renders it, even ones
// with nothing to do with responsive behavior. `matches: false` (desktop) matches
// useIsMobile's own SSR-safe default, so this doesn't change any existing test's behavior.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom has no IntersectionObserver at all — framer-motion's `whileInView` (first used by
// the welcome page's scroll-reveal sections) calls it on mount and throws otherwise. This
// stub never actually fires a callback: tests don't need the reveal animation to trigger,
// since RTL queries the DOM directly regardless of the element's animated opacity/transform.
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver = IntersectionObserverStub;
}
