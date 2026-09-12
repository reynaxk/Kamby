import { createPublicClient, http, type PublicClient } from 'viem';
import { erc20MetadataAbi } from './erc20-abi';
import { retryRpcCall } from './retry';
import type { ChainDataProvider, ChainDescriptor, TokenMetadata } from './types';

export interface EvmChainConfig {
  chain: ChainDescriptor;
  /**
   * The resolved RPC endpoint. This package never reads environment variables itself —
   * the caller resolves the URL from config/secrets and hands it in, so a leaked adapter
   * instance can't be traced back to how the URL was sourced.
   */
  rpcUrl: string;
}

/** ChainDataProvider for EVM-compatible chains (Ethereum, Base, Arbitrum, ...). */
export class EvmChainDataProvider implements ChainDataProvider {
  readonly chain: ChainDescriptor;
  private readonly client: PublicClient;

  constructor(config: EvmChainConfig) {
    this.chain = config.chain;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The on-chain outcome of a submitted transaction — the sole authority for whether a
   * Phase 3 trade confirmed or reverted (see docs/TRADING.md#transaction-lifecycle). `null`
   * means "no receipt yet" — a transaction still pending and an RPC hiccup look the same
   * from here on purpose: neither is grounds to guess a status, only to check again later.
   */
  async getTransactionReceiptStatus(hash: string): Promise<'success' | 'reverted' | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: hash as `0x${string}` });
      return receipt.status;
    } catch {
      return null;
    }
  }

  /**
   * How many blocks have been mined on top of this transaction's own block — see
   * docs/TRADING.md#transaction-lifecycle and TRADING_DEFAULTS.minConfirmations. `0` means
   * "just mined, still in the newest block." `null` — never a guess — when the receipt or
   * the current chain head can't be read right now; callers must treat that as "not yet
   * confirmed enough," the same as a too-low count, never as a pass.
   */
  async getConfirmationCount(hash: string): Promise<number | null> {
    try {
      const [receipt, currentBlock] = await Promise.all([
        this.client.getTransactionReceipt({ hash: hash as `0x${string}` }),
        this.client.getBlockNumber(),
      ]);
      const depth = currentBlock - receipt.blockNumber;
      return depth >= 0n ? Number(depth) : 0;
    } catch {
      return null;
    }
  }

  /**
   * The real, on-chain fields of a transaction (sender, destination, value, calldata) —
   * not just its receipt status. See docs/TRADING.md#transaction-integrity: a receipt only
   * proves *some* transaction with this hash succeeded, never that it's the specific trade
   * a quote described. `null` for "not found" (not yet propagated to this RPC, or genuinely
   * doesn't exist on this chain) — never fabricated, and callers must treat that as
   * inconclusive, not as a pass.
   */
  async getTransactionDetails(hash: string): Promise<{ from: string; to: string | null; value: bigint; data: string } | null> {
    try {
      const tx = await this.client.getTransaction({ hash: hash as `0x${string}` });
      return { from: tx.from, to: tx.to ?? null, value: tx.value, data: tx.input };
    } catch {
      return null;
    }
  }

  /**
   * Each of the three reads is retried independently (see `retryRpcCall`) and — deliberately
   * — issued one at a time rather than via `Promise.all`/`allSettled`'s simultaneous kickoff:
   * a burst of parallel requests is exactly what trips a per-burst rate limit on a shared free
   * RPC (confirmed in production against the public Base endpoint: concurrent reads for the
   * same contract came back "over rate limit" while the identical calls issued sequentially
   * succeeded). Awaiting each read before starting the next keeps the three still independent
   * (one failing doesn't block the others) while never putting more than one request in
   * flight, and a transient blip on *any single field* no longer permanently nulls just that
   * field (a token stuck with a symbol but no decimals, forever, since nothing ever re-reads
   * an existing token's metadata) — retrying each read first fixes that at the source rather
   * than leaving it to whatever calls this to notice and recover.
   */
  async getTokenMetadata(contractAddress: string): Promise<TokenMetadata> {
    const address = contractAddress as `0x${string}`;
    const symbol = await this.readMetadataString(address, 'symbol');
    const name = await this.readMetadataString(address, 'name');
    const decimals = await this.readMetadataDecimals(address);

    return { symbol, name, decimals };
  }

  private async readMetadataString(
    address: `0x${string}`,
    functionName: 'symbol' | 'name',
  ): Promise<string | null> {
    try {
      return await retryRpcCall(() =>
        this.client.readContract({ address, abi: erc20MetadataAbi, functionName }),
      );
    } catch {
      return null;
    }
  }

  private async readMetadataDecimals(address: `0x${string}`): Promise<number | null> {
    try {
      const decimals = await retryRpcCall(() =>
        this.client.readContract({ address, abi: erc20MetadataAbi, functionName: 'decimals' }),
      );
      return Number(decimals);
    } catch {
      return null;
    }
  }
}
