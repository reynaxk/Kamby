/**
 * A page loaded just before a deploy can ask for code files the new version no longer has
 * (2026-10-15: QA screenshots taken mid-deploy hit "Something went wrong" on three screens that
 * were fine a minute later). Those errors are fixed by simply loading the page again, so the
 * error screens do that once — at most every 30s, so a real bug can never loop reloads.
 * Dependency-free on purpose: global-error.tsx must not import anything that could itself fail.
 */
const STALE_DEPLOY = /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|error loading dynamically/i;
const KEY = 'kamby:stale-deploy-reload';

export function reloadIfStaleDeploy(error: { name?: string; message?: string }): boolean {
  if (typeof window === 'undefined' || !STALE_DEPLOY.test(`${error.name ?? ''} ${error.message ?? ''}`)) return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // no storage (private mode) — still reload once; the page can't remember, but a stale
    // deploy is a one-off, not a loop
  }
  window.location.reload();
  return true;
}
