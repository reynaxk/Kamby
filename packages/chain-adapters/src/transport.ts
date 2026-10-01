import { fallback, http, type Transport } from 'viem';
import { recordRpcRequest } from './rpc-usage';

/**
 * A single RPC URL, or a primary + fallback pair via viem's own `fallback()` transport —
 * see docs/TRADING.md#rpc-failover. viem's fallback transport already retries each
 * transport internally and moves to the next one in the list when a request errors, so this
 * deliberately doesn't hand-roll a second retry/circuit-breaker layer on top of viem's own —
 * see solana-connection-pool.ts (apps/api/src/chain/) for why Solana takes a different,
 * hand-rolled approach instead: @solana/web3.js's Connection has no equivalent built-in
 * multi-endpoint failover to lean on.
 *
 * `shouldThrow` overrides viem's own default, which treats an error carrying code -32003 as
 * a `TransactionRejectedRpcError` — a genuine rejection that would fail identically on any
 * node, not worth retrying elsewhere — and gives up immediately without ever trying the
 * fallback. Confirmed live in production (2026-09-14): QuickNode reuses that exact same
 * JSON-RPC error code for "daily request limit reached," an entirely different, transient,
 * provider-specific condition that a fallback endpoint can absolutely serve instead — but
 * viem's default couldn't tell the two apart, so market ingestion silently stopped reading
 * any pool state the moment QuickNode's daily cap was hit, real fallback URL configured or
 * not. Every real caller of this helper (`EvmChainDataProvider`, `UniswapV3PoolReader`,
 * `KyberSwapRouter`'s allowance check) only ever reads — none call `sendTransaction`/
 * `writeContract` — so `TransactionRejectedRpcError`/`UserRejectedRequestError` genuinely
 * can't occur here in the sense viem's default guards against; always trying the fallback is
 * correct for this package's actual usage, not just a workaround for one provider's quirk.
 */
export function createEvmTransport(rpcUrl: string | readonly string[], rpcUrlFallback?: string | null): Transport {
  // An ordered list (see PUBLIC_EVM_RPC_URLS) is the same fallback chain, just longer.
  const urls = [...(typeof rpcUrl === 'string' ? [rpcUrl] : rpcUrl), ...(rpcUrlFallback ? [rpcUrlFallback] : [])];
  if (urls.length === 0) throw new Error('createEvmTransport needs at least one RPC URL');
  // Every request is counted (provider + method) for the usage reports — see rpc-usage.ts.
  const metered = (url: string) => http(url, { onFetchRequest: (_request, init) => recordRpcRequest(url, init.body) });
  return urls.length === 1 ? metered(urls[0]!) : fallback(urls.map(metered), { shouldThrow: alwaysTryFallback });
}

/** Named and exported purely so the exact production incident (QuickNode's -32003 "daily
 *  request limit" colliding with viem's own TransactionRejectedRpcError code) has a direct,
 *  fast unit test — see createEvmTransport's own doc comment for the full story. */
export function alwaysTryFallback(): boolean {
  return false;
}
