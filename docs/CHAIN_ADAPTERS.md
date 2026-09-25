# Chain-adapter principles

`packages/chain-adapters` is the seam between EVM-chain-specific behavior and everything
else — business logic, the API, the database, the UI. **EVM-only, deliberately** — see
"Where Solana fits" below for why Solana was built as a separate, parallel stack rather than
a second implementation of this package's interface, reversing what this doc originally
predicted.

## The contract

```ts
interface ChainDataProvider {
  readonly chain: ChainDescriptor;
  isHealthy(): Promise<boolean>;
  getTokenMetadata(contractAddress: string): Promise<TokenMetadata>;
}
```

Anything that needs to read from an EVM chain depends on this interface, never on a
concrete chain's SDK directly. `EvmChainDataProvider`
(`packages/chain-adapters/src/evm-adapter.ts`) is still the only implementation — and,
unlike this doc's original "one class per chain" assumption, that's by design, not a gap:
it's chain-*parametrized* via its constructor (`EvmChainConfig { chain, rpcUrl,
rpcUrlFallback }`), so Base, Arbitrum, BNB Chain, and Ethereum (all four registered in
`packages/domain/src/chain-registry.ts`, though not all are live in every deployment — see
`apps/api/src/config/env.ts`'s `CHAINS` env var and `getConfiguredChains`) are four
*instances* of one class, not four classes. Adding a fifth EVM chain means a new
`CHAIN_REGISTRY` entry and config, not new code here.

A narrower reader lives alongside it: `UniswapV3PoolReader` (`uniswap-v3.ts`) — pool state,
token balances/supply, Swap event logs, and (added 2026-09-25) Factory `PoolCreated` events
for automated discovery (see `docs/MARKET_DATA.md#automated-pool-discovery`). It isn't part
of the `ChainDataProvider` interface (a pool reader is protocol-specific, not
chain-generic), but it follows the same rules below. Confirmed identical across every EVM
chain Kamby trades on so far, including BNB Chain — PancakeSwap V3 is a real
Uniswap-V3-ABI-compatible fork (`slot0()`/`token0()`/`token1()`/`fee()`/`liquidity()` all
decode correctly against live BNB Chain pools, confirmed 2026-09-16), so BNB needed zero new
reader code, only a `dex: 'pancakeswap-v3'` label for display purposes
(`apps/workers/src/market/seed-markets.ts`). An Aerodrome/Solidly-style reader (a genuinely
different reserves model, not just a different chain) would be a real sibling class — not
built, since Kamby doesn't track any Aerodrome-only pools (see `docs/MARKET_DATA.md`'s notes
on why AERO was ruled out as a Base seed-list candidate for exactly this reason). The
price/liquidity *math* those reads feed into lives separately again, in
`uniswap-v3-math.ts` — pure functions with no RPC calls, so they're unit-testable without a
network (see `docs/MARKET_DATA.md#price-methodology`).

## Where Solana fits: it doesn't — a deliberate, separate stack

This doc originally predicted "a Solana adapter later implements the same interface... the
rest of the application doesn't change." That didn't happen, and it isn't a gap to fill —
Solana trading (`apps/api/src/solana/`: `JupiterQuoteService`, `SolanaQuoteService`,
`SolanaTransactionService`, `SolanaTopupService`, `GasRelayerService`, all wired in
`solana.module.ts`) was built as a fully independent system that imports nothing from
`@kamby/chain-adapters` at all. It reads `@solana/web3.js` directly, prices swaps through
Jupiter's own HTTP API rather than on-chain pool reads, and has its own RPC-failover pool
(`apps/api/src/chain/solana-connection-pool.ts` — its own doc comment calls this out
explicitly: "Solana's counterpart to viem's built-in `fallback()` transport... hand-rolls
the same idea"). `solana.module.ts` documents the relationship plainly: "Additive alongside
TradingModule (EVM), not a replacement; no import either direction."

Why this was the right call rather than a shortcut: Solana's actual data-availability model
(no `ChainDataProvider`-shaped "read this contract's state" primitive the way EVM has one;
swap pricing genuinely goes through an aggregator, not a pool contract read) doesn't map
cleanly onto an interface designed around EVM's `readContract` semantics — forcing a
`SolanaChainDataProvider` to satisfy `ChainDataProvider`'s shape would have meant faking
parts of the interface that don't have a real Solana equivalent, or weakening the interface
until it stopped meaningfully constraining anything. Two honest, protocol-appropriate stacks
beat one interface stretched thin over two very different chains.

## Rules this package follows (EVM only)

- **It never reads `process.env` itself.** The caller resolves an RPC URL from
  config/secrets and passes it in (`EvmChainConfig.rpcUrl`). This keeps the package
  testable and keeps "where did this URL come from" traceable to one place per app.
- **It never fabricates a value.** `getTokenMetadata()` returns `null` for any field it
  can't confirm on-chain, using `Promise.allSettled` rather than letting one failed call
  fail the whole read. See `docs/SOURCE_OF_TRUTH.md`.
- **It stays small.** No plugin system, no chain-specific subclassing. `ChainAdapterRegistry`
  (`types.ts`, `ReadonlyMap<string, ChainDataProvider>`) is exported as a shape consumers
  *could* use, but in practice every real consumer rolls its own differently-keyed map
  inline instead — e.g. `apps/api/src/trading/transaction.service.ts`'s
  `Map<number, EvmChainDataProvider>`, built once in the constructor from
  `getConfiguredChains()` and looked up by numeric chain id, not the exported type's CAIP-2
  string key. Worth knowing if you go looking for where `ChainAdapterRegistry` is actually
  used: it isn't, anywhere, as of 2026-09-25 — each consumer's own inline `Map` has
  consistently been simpler than importing and conforming to the shared type.
- **It never implements indexing, trading, or persistence.** This package answers "what
  does this EVM chain say right now" — nothing about turning that into stored rows (that's
  `apps/workers`) or executing a trade (that's `apps/api/src/trading`).

## Where it's used today

- `apps/api/src/trading/transaction.service.ts` — one `EvmChainDataProvider` per configured
  EVM chain, built at startup from `getConfiguredChains()`, looked up per-trade by chain id.
- `apps/workers/src/main.ts` — one `EvmChainDataProvider` per deployment (each `apps/workers`
  instance runs exactly one chain — see `docs/MARKET_DATA.md#supported-chains`), to prove
  connectivity at boot, alongside `MarketIngestionService`
  (`apps/workers/src/market/ingestion.ts`), which is the real consumer: token metadata via
  `EvmChainDataProvider`, pool state/balances/Swap events via `UniswapV3PoolReader`.
- `apps/workers/src/market/pool-discovery.ts` (`PoolDiscoveryService`, added 2026-09-25) —
  same two readers, for automated Factory-event-driven discovery instead of the static seed
  list — see `docs/MARKET_DATA.md#automated-pool-discovery`.
