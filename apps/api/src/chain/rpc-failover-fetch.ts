/** Solana's own public RPC — rate limited, but free and always there as a last resort. */
export const PUBLIC_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

/** JSON-RPC error codes providers use for "over your plan / rate limit" (QuickNode, Helius). */
const LIMIT_CODES = new Set([-32005, -32007, -32029, -32429]);

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Exported for tests. Whether the primary RPC's answer means "try the other one". */
export async function isUnusable(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403 || res.status >= 500) return true;
  if (!res.ok) return false;
  try {
    const body = (await res.clone().json()) as { error?: { code?: number } } | { error?: { code?: number } }[];
    const errors = Array.isArray(body) ? body.map((b) => b.error) : [body.error];
    return errors.some((e) => e?.code !== undefined && LIMIT_CODES.has(e.code));
  } catch {
    return false;
  }
}

/**
 * A `fetch` for `@solana/web3.js`'s Connection that sends each RPC call to the primary URL
 * and, when that provider refuses it (down, out of credits, rate limited), repeats the same
 * call on the fallback (2026-10-29: every sponsored Solana buy failed with a 500 while the
 * plain quote — which never touches RPC — worked, pointing at the paid RPC running dry).
 */
export function failoverFetch(fallbackUrl: string, onFailover?: (reason: string) => void, base: FetchFn = fetch): FetchFn {
  return async (input, init) => {
    try {
      const res = await base(input, init);
      if (!(await isUnusable(res))) return res;
      onFailover?.(`status ${res.status}`);
    } catch (error) {
      onFailover?.(error instanceof Error ? error.message : 'network error');
    }
    return base(fallbackUrl, init);
  };
}
