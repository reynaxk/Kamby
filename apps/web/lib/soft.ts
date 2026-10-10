/**
 * Waits at most `ms` for a page's secondary data, then renders without it (2026-10-10: a cold
 * Base coin page took 80s because its chart history hung on the API — the page waited for
 * everything). The parts that get the fallback load themselves in the browser anyway
 * (chart candles, activity, traders), so a slow one never holds the whole screen.
 */
export function soft<T>(promise: Promise<T>, fallback: T, ms = 3500): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
