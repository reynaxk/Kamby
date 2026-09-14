# Multi-chain expansion plan (Solana + Base + Robinhood Chain) — early October target

**Status: proposed, not started. Explicitly post-Sep 20** — locked in 2026-09-14, the
morning after Solana's first confirmed live trade, specifically so nothing here gets built
under launch-deadline pressure. See [[solana-launch-scope]] for what's already live.

This doc distinguishes **verified facts** from **open decisions still needing a call** —
several claims in the original spec this was drafted from didn't match what's actually
live, or reverse working infrastructure without saying so. Don't treat the "open decisions"
section as settled just because it's written down.

## Verified facts

- **Robinhood Chain is real**: mainnet live since 2026-07-01, a Layer-2 built on Arbitrum
  (EVM-compatible, settles to Ethereum), **chain ID 4663**, 100ms block times, Uniswap and
  Chainlink integrated from launch. Confirmed via multiple independent sources 2026-09-14
  (Coindesk, Robinhood's own newsroom, fintech.global). Not fabricated — genuinely check-
  able and checked out.
- **Privy supports unified Solana + EVM accounts** under one user, base58 and 0x addresses
  both — this is a real Privy capability, not aspirational.

## Open decisions — not yet settled, despite being in the original spec as "finalized"

1. **Platform fee: 1.3% vs. what's actually live.** Base currently charges `PLATFORM_FEE_BPS
   =75` (0.75%). Solana ships tiered — 100bps under $50, 75bps at $50+ (see
   [[solana-launch-scope]]) — as of 2026-09-14, hours before this doc was written. A flat
   1.3% would be a real, deliberate increase on both, not a continuation of anything
   already decided. Needs an explicit business decision, not just a number carried over
   from a pasted spec.
2. **Drop LI.FI for direct Uniswap v3 / Aerodrome contract calls on Base.** LI.FI is not a
   stub — it's the current, live, tested Base router
   (`apps/api/src/trading/router/li-fi-router.service.ts`, real tests, real production
   traffic). Going direct means:
   - Building and maintaining swap calldata construction ourselves (Uniswap V3
     `exactInputSingle`/`exactInput`, Aerodrome's own router ABI) — real, security-
     sensitive work; a calldata mistake here costs real user funds, same risk class as the
     (deliberately deferred, carefully guarded) Solana gas relayer.
   - Losing LI.FI's multi-DEX price comparison and routing — a direct integration only
     routes through whichever pools this backend explicitly knows about, not "best price
     across everything LI.FI aggregates."
   - "Zero third-party dependency" isn't free — it trades an aggregator's maintained,
     audited routing logic for this codebase's own, unaudited version of the same thing.
   This may still be the right call (fee retention is a real, understandable motivation),
   but it should be made knowing the tradeoff, not framed as a pure simplification.
3. **Migrating EVM auth from wagmi to Privy.** Kamby's live EVM wallet flow
   (`apps/web/lib/wagmi-config.ts`, `ConnectWalletButton.tsx`) is wagmi-based (injected/
   Coinbase Wallet/WalletConnect) — completely separate from the Solana-only Privy
   integration shipped this session. "Unified accounts" means migrating the *working* EVM
   flow to Privy too, not just extending what Solana already has. That's a real change to
   tested, live infrastructure, not a greenfield add.

## Sprint scope, as proposed (still contingent on the decisions above)

- `MultiChainRouter` service: branches execution between Solana (Jupiter + optional Jito,
  already built — see [[solana-launch-scope]] and `docs/GAS_RELAYER_PLAN.md`) and EVM
  (LI.FI or direct-contract, pending decision #2 above).
- Top-bar network selector `[ SOL | BASE | RH ]` with pasted-contract-address auto-detection
  (base58 vs. 0x-hex is a cheap, reliable heuristic for this part specifically — genuinely
  simple regardless of the routing-engine decision).
- RH (Robinhood Chain) trading: needs its own QuickNode (or equivalent) RPC endpoint —
  confirm one is actually available for chain 4663 before assuming QuickNode coverage: not
  yet checked as of this doc.

## Why this isn't scoped for implementation yet

A `NetworkContext` that treats Solana and EVM chains as interchangeable behind one selector
is only honest once the underlying execution paths are actually unified — right now they're
two independently-built pipelines (different wallet model, different quote schema,
different transaction service, different UI components). Building the selector before
resolving decisions #2 and #3 above would produce a UI that *looks* like it switches chains
cleanly while silently not actually routing correctly for at least one of them. Resolve the
three open decisions first; the selector and `MultiChainRouter` are the easy part once the
underlying architecture is actually settled.
