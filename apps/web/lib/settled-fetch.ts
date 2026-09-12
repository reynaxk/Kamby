/**
 * A page that bundles several independent data sections into one `Promise.all` (the
 * homepage's ~10 sections, a trader profile's activity + tokens, etc.) previously took the
 * *entire page* down to a 500 the moment any single section's fetch failed — a backend
 * blip on "Large trades" had no business also killing "What's moving," "Top traders," and
 * everything else on the same page. Wrapping each independent fetch in this instead means
 * a failure degrades that one section to its empty state (the same state `EmptyState`
 * already renders for "no data yet") rather than the whole page.
 *
 * Deliberately not used for a page's *primary* content (e.g. a trader profile's own
 * `fetchTraderProfile`, a token page's own `fetchToken`) — a page that has nothing to show
 * without that fetch should still 404/error clearly, not silently render an empty shell
 * that looks like a real "no data" state.
 */
export async function settledOr<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    // Server-side only (this is always called from a Server Component) — surfaces in
    // Next.js's own server logs without touching the response the client actually gets.
    console.error('[settledOr] a page section fetch failed — degrading to its empty state', error);
    return fallback;
  }
}
