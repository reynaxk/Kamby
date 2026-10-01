/**
 * Counts every JSON-RPC call this process makes, by provider and method (2026-10-01: the
 * QuickNode plan hit its limit and had to be upgraded — usage must be visible, not guessed).
 * Fed by createEvmTransport; reported on an interval by startRpcUsageReporter.
 *
 * Only a provider *label* is ever recorded — the hostname, never the path/query, which is
 * where providers like QuickNode and Alchemy put the API key.
 */
const counts = new Map<string, Map<string, number>>();

/** Exported for tests. `abc.base-mainnet.quiknode.pro` → `quicknode:base-mainnet`; any other
 *  host is kept as-is (its key, if any, lives in the path, which is dropped). */
export function providerLabel(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const quicknode = host.match(/^[^.]+\.([^.]+)\.(?:quiknode\.pro|quicknode\.com)$/);
    if (quicknode) return `quicknode:${quicknode[1]}`;
    return host;
  } catch {
    return 'unknown';
  }
}

/** Paid providers — the ones worth alerting on. */
export function isPaidProvider(label: string): boolean {
  return label.startsWith('quicknode:') || label.includes('alchemy') || label.includes('infura') || label.includes('helius');
}

function methodsOf(body: unknown): string[] {
  if (typeof body !== 'string') return ['unknown'];
  try {
    const parsed = JSON.parse(body) as unknown;
    const calls = Array.isArray(parsed) ? parsed : [parsed];
    return calls.map((c) => (c && typeof c === 'object' && typeof (c as { method?: unknown }).method === 'string' ? (c as { method: string }).method : 'unknown'));
  } catch {
    return ['unknown'];
  }
}

export function recordRpcRequest(url: string, body: unknown): void {
  const label = providerLabel(url);
  let byMethod = counts.get(label);
  if (!byMethod) counts.set(label, (byMethod = new Map()));
  for (const method of methodsOf(body)) byMethod.set(method, (byMethod.get(method) ?? 0) + 1);
}

export interface RpcUsageEntry {
  provider: string;
  paid: boolean;
  total: number;
  methods: Record<string, number>;
}

/** Counts since the last call, busiest provider first; resets the counters. */
export function takeRpcUsageSnapshot(): RpcUsageEntry[] {
  const entries = [...counts].map(([provider, byMethod]) => {
    const methods = Object.fromEntries([...byMethod].sort((a, b) => b[1] - a[1]));
    return { provider, paid: isPaidProvider(provider), total: [...byMethod.values()].reduce((a, b) => a + b, 0), methods };
  });
  counts.clear();
  return entries.sort((a, b) => b.total - a.total);
}

/**
 * Logs an RPC usage summary every `intervalMs` (default 10 min) — one line per provider that
 * was used, so a spike shows up in the logs with the exact methods behind it. Silent when
 * nothing was called. Returns a stop function.
 */
export function startRpcUsageReporter(log: (message: string, entries: RpcUsageEntry[]) => void, intervalMs = 10 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    const entries = takeRpcUsageSnapshot();
    if (entries.length === 0) return;
    const paid = entries.filter((e) => e.paid).reduce((sum, e) => sum + e.total, 0);
    const minutes = Math.round(intervalMs / 60_000);
    log(`RPC usage, last ${minutes} min: ${paid} paid calls — ${entries.map((e) => `${e.provider} ${e.total}`).join(', ')}`, entries);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
