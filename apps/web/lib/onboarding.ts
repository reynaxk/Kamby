/** Getting started's steps (2026-10-31): which ones this browser has done, kept in localStorage. */
export const START_KEYS = {
  dismissed: 'kamby:getting-started-off',
  traded: 'kamby:first-trade',
  explored: 'kamby:explored-social',
} as const;

export function readStep(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Marks a step done from anywhere (a trade, a visit to Live or the Feed). */
export function markStep(step: 'traded' | 'explored' | 'dismissed'): void {
  try {
    localStorage.setItem(START_KEYS[step], '1');
  } catch {
    // storage blocked — the step just stays open
  }
}
