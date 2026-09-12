/**
 * A single RPC call intermittently failing — a rate-limited public endpoint, a transient
 * network blip — doesn't mean the data is unavailable, just that *this one attempt* was
 * unlucky. Every reader in this package already has a "return null on failure, never
 * throw" contract (see UniswapV3PoolReader/EvmChainDataProvider's own doc comments) so a
 * caller can safely skip a tick — this wraps the underlying call with a few quick retries
 * first, so a transient blip gets smoothed over in milliseconds instead of costing an
 * entire ingestion tick (60s) before the next attempt. Still returns/throws exactly as the
 * wrapped function would on a genuine, persistent failure — this changes *when* it gives
 * up, never *whether* it does.
 */
export async function retryRpcCall<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 200 }: { attempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
