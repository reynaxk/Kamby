import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createEvmTransport } from '@kamby/chain-adapters';
import type { ChainSlug } from '@kamby/domain';
import { createPublicClient, createWalletClient, http, type Account, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getConfiguredChains, getEvmGasRelayerConfig, type Env } from '../../config/env';

/** Every EVM chain this codebase currently configures uses an 18-decimal native currency
 *  (Base/Arbitrum: ETH, BNB Chain: BNB) — verify this doesn't quietly stop holding before
 *  adding a chain whose native currency differs. Kept small and explicit rather than
 *  reaching for `viem/chains`' predefined chain objects: those may not exactly match this
 *  deployment's own configured RPC URLs, and a mismatch there is exactly the kind of
 *  shape-looks-right-but-isn't-what-we-actually-use risk this class's other doc comments
 *  already warn against. */
const NATIVE_CURRENCY_BY_SLUG: Record<ChainSlug, { name: string; symbol: string; decimals: number }> = {
  base: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  arbitrum: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  bnb: { name: 'BNB', symbol: 'BNB', decimals: 18 },
};

/** A minimal, explicit `Chain` object bound to both clients below — deliberately never
 *  left to viem's own implicit chain-id auto-detection (an unbound wallet client falls
 *  back to an `eth_chainId` RPC call to figure out what to sign for). For a service that
 *  signs and broadcasts real transactions, an explicit, known-correct chain id beats an
 *  implicit one resolved from whatever the RPC endpoint happens to answer at call time. */
function buildChain(slug: ChainSlug, chainId: number, rpcUrl: string): Chain {
  return {
    id: chainId,
    name: slug,
    nativeCurrency: NATIVE_CURRENCY_BY_SLUG[slug],
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

export interface EvmRelayerChainClients {
  chainId: number;
  /** The exact `Chain` object bound to `publicClient`/`walletClient` at construction —
   *  exposed so `EvmGasRelayerService#broadcast` can pass it explicitly to
   *  `sendTransaction` (viem requires an explicit `chain` per call when the client's own
   *  type doesn't statically carry one, and passing the real bound chain here — rather
   *  than `chain: null`, which would disable viem's own chain-match validation — keeps
   *  that safety check active). */
  chain: Chain;
  maxGasPriceGwei: number;
  maxWeiCeiling: number;
  /** Read-only use only (nonce reads, gas estimation, simulation, fee history) — the same
   *  fallback-capable transport every other read-only caller in this codebase already
   *  relies on (`createEvmTransport`). */
  publicClient: PublicClient;
  /** Signing + broadcast only — see the class doc comment for why this is deliberately a
   *  single, primary-RPC-only transport, not `createEvmTransport`'s fallback-capable one. */
  walletClient: WalletClient;
  account: Account;
}

/**
 * Builds one {publicClient, walletClient, account} triple per chain this deployment's
 * relayer actually covers (`EVM_GAS_RELAYER_CHAINS`) — a strict subset of
 * `getConfiguredChains()`'s result; never assume every self-paid-trading chain is also
 * relayer-covered. The account is built from `EVM_GAS_RELAYER_PRIVATE_KEY` once at
 * construction — the same key on every chain, since (unlike Solana) one EVM private key
 * produces the same address on every EVM chain. Never logged — see the `redact` config in
 * app.module.ts, which already anticipates a `*.privateKey` path.
 *
 * `walletClient`'s transport is deliberately plain `http(rpcUrl)`, never
 * `createEvmTransport`'s fallback-capable transport that every other caller in this
 * codebase uses for reads (`KyberSwapRouter`'s allowance check, `EvmChainDataProvider`).
 * `createEvmTransport`'s own doc comment is explicit that its "always retry the fallback,
 * even past what looks like a genuine on-chain rejection" behavior is safe only because
 * every existing caller is read-only. This service is the first real caller that calls
 * `sendRawTransaction` — blindly retrying a broadcast against a second RPC endpoint (a
 * different node, a different view of the mempool, one that may have already accepted the
 * first attempt) is a materially different risk than retrying an idempotent read. A
 * broadcast failure here should surface as a failure the relayer's own logic decides how
 * to handle, never silently retry against a different endpoint underneath it.
 */
@Injectable()
export class EvmRelayerWalletService {
  private readonly clients: ReadonlyMap<ChainSlug, EvmRelayerChainClients>;
  /** `null` means no restriction (every wallet eligible) — see
   *  `EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES`'s own doc comment in config/env.ts for the
   *  exact rollout intent. Exposed here (not just inside `getEvmGasRelayerConfig`) so
   *  `EvmGasRelayerQuoteService` (sub-piece 4d) can gate sponsorship eligibility without
   *  re-reading `ConfigService` a second time. */
  readonly testWalletAddresses: ReadonlySet<string> | null;

  constructor(config: ConfigService<Env, true>) {
    const relayerConfig = getEvmGasRelayerConfig((key) => config.get(key, { infer: true }));
    this.testWalletAddresses = relayerConfig?.testWalletAddresses ?? null;
    if (!relayerConfig) {
      this.clients = new Map();
      return;
    }

    const chainsBySlug = new Map(getConfiguredChains((key) => config.get(key, { infer: true })).map((c) => [c.slug, c]));
    const account = privateKeyToAccount(relayerConfig.privateKey as `0x${string}`);

    this.clients = new Map(
      relayerConfig.chains.map((relayerChain) => {
        const chain = chainsBySlug.get(relayerChain.slug);
        if (!chain) {
          // Should be unreachable — ValidatedEnvSchema's fourth superRefine already requires
          // every EVM_GAS_RELAYER_CHAINS slug to also be listed in CHAINS. A loud failure
          // here is strictly better than silently constructing a client with no RPC config,
          // per this codebase's own "fail loudly at boot, never silently no-op" discipline.
          throw new Error(`EVM_GAS_RELAYER_CHAINS lists "${relayerChain.slug}" but getConfiguredChains() has no entry for it`);
        }
        const viemChain = buildChain(relayerChain.slug, chain.chainId, chain.rpcUrl);
        const clients: EvmRelayerChainClients = {
          chainId: chain.chainId,
          chain: viemChain,
          maxGasPriceGwei: relayerChain.maxGasPriceGwei,
          maxWeiCeiling: relayerChain.maxWeiCeiling,
          publicClient: createPublicClient({ chain: viemChain, transport: createEvmTransport(chain.rpcUrl, chain.rpcUrlFallback) }),
          walletClient: createWalletClient({ account, chain: viemChain, transport: http(chain.rpcUrl) }),
          account,
        };
        return [relayerChain.slug, clients];
      }),
    );
  }

  /** `null` when this chain isn't relayer-covered on this deployment (not listed in
   *  EVM_GAS_RELAYER_CHAINS, or the relayer isn't enabled at all) — every caller must
   *  handle that explicitly, same "no silent default" discipline as
   *  getSolanaConfig/getEvmGasRelayerConfig in config/env.ts. */
  forChain(slug: ChainSlug): EvmRelayerChainClients | null {
    return this.clients.get(slug) ?? null;
  }

  /** The relayer's own address — safe to expose (never the private key). Used to build the
   *  EIP-712 domain's `verifyingContract` field and `TradeTransaction.relayerFeePayer`.
   *  `null` when no relayer is configured on this deployment. The same address on every
   *  configured chain (see the class doc comment), so any one chain's account suffices. */
  get relayerAddress(): string | null {
    const first = [...this.clients.values()][0];
    return first ? first.account.address : null;
  }
}
