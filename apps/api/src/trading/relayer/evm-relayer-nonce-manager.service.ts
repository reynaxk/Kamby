import { Injectable } from '@nestjs/common';
import type { ChainSlug } from '@kamby/domain';

/**
 * The EVM relayer's nonce-serialization primitive — see docs/GAS_RELAYER_PLAN.md's EVM
 * section ("What's genuinely harder here than Solana"). Solana has no equivalent: a
 * relayer transaction there only needs a recent blockhash, never a strictly-ordered
 * per-signer counter, so nothing in `GasRelayerService` corresponds to this class.
 *
 * One relayer EOA per configured chain (`EVM_GAS_RELAYER_CHAINS`), so the nonce space is
 * per chain — two different chains' relayer broadcasts never contend with each other and
 * run fully concurrently. Within a single chain, `runExclusive` guarantees `fn` for one
 * caller only starts once the *previous* caller's `fn` has itself finished *running* — not
 * once it has confirmed on-chain. This is a deliberate, narrow scope: `fn` should read the
 * pending nonce, sign, submit to the mempool, and return — nothing more. Awaiting
 * confirmation inside `fn` would serialize throughput to block time (~2s on Base), which
 * defeats the entire point: multiple relayed trades can have transactions in flight in the
 * mempool simultaneously, as long as they were *submitted* in strict, gap-free nonce order.
 *
 * Deliberately out of scope for launch, per the plan: stuck-nonce recovery and
 * speed-up/replacement-transaction logic. If a broadcast fails after this class has already
 * handed out its nonce slot (an RPC drops it, a reorg edge case), the relayer's nonce
 * sequence can get stuck and needs a human to look at a block explorer — acceptable only
 * because `TradeQuote.relayerNonce`/`relayerStatus`/`updatedAt` (see schema.prisma) carry
 * enough for that human to manually diagnose it.
 *
 * A hand-rolled promise chain, not a library (`async-mutex` or similar) — the whole
 * primitive is "run this after whatever's currently at the front of the line finishes,"
 * which a promise chain already expresses directly with no extra dependency.
 */
@Injectable()
export class EvmRelayerNonceManagerService {
  /** Per-chain tail of the promise chain — deliberately swallows both success and failure
   *  before being stored, so one caller's `fn` throwing never leaves the chain's queue
   *  permanently jammed for every later caller on that same chain. */
  private readonly tail = new Map<ChainSlug, Promise<void>>();

  async runExclusive<T>(chain: ChainSlug, fn: () => Promise<T>): Promise<T> {
    const previous = this.tail.get(chain) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    this.tail.set(
      chain,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
