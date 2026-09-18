# Multi-chain expansion plan (Solana + Base + launchpad discovery) — early October target

**Status: proposed, not started. Explicitly post-Sep 20** — locked in 2026-09-14, the
morning after Solana's first confirmed live trade, specifically so nothing here gets built
under launch-deadline pressure. See [[solana-launch-scope]] for what's already live.

**Revision 2026-09-14 (later same day): scope changed.** The original version of this doc
targeted Solana + Base + Robinhood Chain. That's been explicitly replaced — the user
confirmed a deliberate scope change, not drift: October now targets **deeper Solana + Base**
(launchpad/trench discovery, a third Base aggregator) instead of adding a third chain.
Robinhood Chain is removed from scope. Its "verified facts" entry is kept below, struck
through, for the record — the chain itself is real, it's just no longer part of this plan.

One piece originally listed here as post-launch got pulled forward the same day it was
written: **RPC provider failover/circuit-breaking for Helius + QuickNode is launch-scoped,
not October-scoped** — it's the direct fix for a real P0 (QuickNode already exhausted its
daily quota once in production, with zero fallback, on a chain that's live today). See
`apps/api/src/chain/` once built. Everything else in this doc remains October-scoped.

**Revision 2026-09-15: open decision #3 (Privy for EVM) expanded into a real plan**, after
a live wallet-connect incident prompted the user to ask for it immediately. Originally kept
October-scoped rather than built under launch pressure — see that section for the full
writeup, including what already exists (more than expected — the provider wrapper and a
chain-agnostic sign-in trigger are already shipped for Solana) and what's genuinely new.

**Revision 2026-09-15 (later same day): decision #3 explicitly reversed and shipped for
launch.** The user changed plans again — after weighing the exact risk named below (the
wagmi EVM connect path had just been fixed and never confirmed with a real trade;
"replace" means no fallback if the new signing path has any issue), and after that risk was
restated a second time via an explicit confirmation question, the user chose to ship the
full Privy EVM/BNB migration now rather than defer it: **"Full replace, build now."** It is
done: `apps/web/lib/privy-config.ts`, `apps/web/lib/wagmi-config.ts`, `apps/web/app/providers.tsx`,
and `apps/web/components/wallet/ConnectWalletButton.tsx` all ship it — see
`docs/TRADING.md#wallet-connectivity` for the resulting architecture. `wagmiConfig.chains`
now lists BNB Chain (`bsc`) alongside Base too (the backend `OpenOceanRouter`/
`MultiChainSwapRouter` piece below was *also* pulled forward and shipped the same day, ahead
of this doc's original October target — see git history on `apps/api/src/trading/router/`).
Trading itself is **not** enabled on BNB Chain yet either way (`apps/api`'s `CHAINS` still
excludes `"bnb"`) — only wallet recognition and backend routing are live; turning BNB
trading on for real users is still a distinct, deliberate step. The EVM-Privy write-up
immediately below is kept as the historical plan/rationale, not a description of remaining
work.

## Verified facts

- ~~Robinhood Chain is real: mainnet live since 2026-07-01, a Layer-2 built on Arbitrum
  (EVM-compatible, settles to Ethereum), chain ID 4663, 100ms block times, Uniswap and
  Chainlink integrated from launch. Confirmed via multiple independent sources 2026-09-14
  (Coindesk, Robinhood's own newsroom, fintech.global).~~ **No longer in scope** — kept here
  only so a future revisit doesn't have to re-verify it from scratch.
- **Privy supports unified Solana + EVM accounts** under one user, base58 and 0x addresses
  both — this is a real Privy capability, not aspirational. Still relevant if decision #3
  below (wagmi → Privy migration) is ever made.
- **Pump.fun launchpad integration is back in scope**, reversing an earlier decision this
  same session to decline it. This is a real, separate protocol from Jupiter/Raydium — its
  bonding-curve program emits its own on-chain data, not something Jupiter's quote API
  surfaces. Needs its own ingestion path (see below), not an extension of the existing
  Jupiter integration.
- **The trench-categorization scaffolding already exists** —
  `apps/api/src/tokens/token-trenches.service.ts`, `token-trenches.controller.ts`, and a
  `TrenchesCategory` enum already define `FRESH` / `NEAR_GRADUATED` / `JUST_GRADUATED` /
  `TRENDING_HOLDERS`. Only `TRENDING_HOLDERS` is implemented today; the other three cleanly
  throw `NotImplementedException` (501) rather than faking data. October's launchpad work
  should implement these existing categories, not fork a parallel pipeline.

## Open decisions — not yet settled, despite being in the original spec as "finalized"

1. **Platform fee: 1.3% vs. what's actually live.** Base currently charges `PLATFORM_FEE_BPS
   =75` (0.75%) as a flat rate. Solana ships tiered — 100bps under $50, 75bps at $50+ (see
   [[solana-launch-scope]]). A flat 1.3% on Base, or extending Solana's tiered schedule to
   Base, would both be real, deliberate fee changes — not a continuation of anything already
   decided. Needs an explicit business decision.
2. **KyberSwap as a third Base aggregator.** The live `MetaAggregatorSwapRouter`
   (`apps/api/src/trading/router/meta-aggregator-router.service.ts`) already races LI.FI and
   1inch in parallel and takes whichever prices more output — see that file's own doc
   comment on why a third *paid* aggregator (0x) was deliberately excluded on cost grounds.
   Adding KyberSwap as a third free/cheap racer is a coherent, buildable extension of that
   existing pattern — **within Base**, alongside the other two, not "instead of" or "racing
   against Jupiter." (Jupiter prices Solana trades; KyberSwap would price Base trades. They
   can never compete for the same trade — a single trade is always on exactly one chain.)
   Confirm KyberSwap's actual API terms/rate limits before committing, the same diligence
   already applied to LI.FI and 1inch.
3. **Migrating EVM auth from wagmi to Privy.** Kamby's live EVM wallet flow
   (`apps/web/lib/wagmi-config.ts`, `ConnectWalletButton.tsx`) is wagmi-based (injected/
   Coinbase Wallet/WalletConnect) — completely separate from the Solana-only Privy
   integration shipped this session. Only relevant if a genuinely unified wallet UX is
   wanted later; not required for the launchpad/KyberSwap work above.

   **Expanded 2026-09-15**, prompted by a real live incident (not a design exercise): a
   Trust Wallet user hit a dead, duplicate connector entry — wagmi's extension-based
   connect flow has real, recurring fragility (a wallet vendor changes how it announces
   itself, or an extension goes stale, and a connection just silently fails). Privy's
   embedded-wallet flow (email/social login, no extension required) is Kamby's own proven
   answer to exactly this class of problem — already shipped and working for Solana. The
   user asked to build this immediately for EVM + BNB Chain; deliberately drafted as a plan
   instead, for the same reason every other item in this doc is deferred: this touches
   trade-*signing* code, 5 days before launch, and deserves the same care Solana's version
   got, not a rushed rewrite of a path (Base trading) that was just confirmed working again
   today after a real chainId bug.

   **What already exists, confirmed by reading the current code — this is an extension, not
   a from-scratch build:**
   - `PrivyProvider` already wraps the *entire* app (`app/providers.tsx`), additive
     alongside `WagmiProvider`, not replacing it. No new provider wrapper needed.
   - The "Sign In" trigger already exists and is chain-agnostic —
     `SolanaTradePanel.tsx`'s `usePrivy().login()` call opens Privy's own modal, which
     Privy's docs confirm handles email/social/external-wallet login uniformly, not a
     Solana-specific flow. The same button can very plausibly create both a Solana *and* an
     EVM embedded wallet on one login — Privy's own docs confirm unified Solana + EVM
     accounts under one user (see "Verified facts" above).
   - `privyConfig` (`lib/privy-config.ts`) currently sets `embeddedWallets: { solana: {
     createOnLogin: 'users-without-wallets' } }` only — no `ethereum` key at all. Adding one
     is the actual scope of "enable EVM embedded wallets," not a rearchitecture.

   **What's genuinely new work:**
   - **EVM wallet ownership verification.** The existing `WalletService`
     (`apps/api/src/identity/wallet.service.ts`) already does ECDSA challenge/verify for
     wagmi-connected wallets — a Privy embedded EVM wallet is still a real ECDSA EOA, so
     this *may* work completely unmodified (only the client-side signing call changes, from
     a wagmi hook to a Privy hook) — needs confirming against Privy's current EVM signing
     API, not assumed.
   - **Trade execution signing.** `TradePanel.tsx`'s sign-and-send step is wagmi-hook-based
     today. Needs its own Privy-hook version, mirroring exactly how `SolanaTradePanel.tsx`
     already split `signAndSendTransaction` (default path) from `signTransaction`-then-
     broadcast-separately (the Jito-tip path) — same non-custodial principle, same "the
     server never signs" rule from docs/WALLET_SECURITY.md, just retargeted at Privy's EVM
     hooks instead of wagmi's.
   - **New-wallet gas top-up, per chain.** A fresh embedded wallet has zero native gas —
     Solana already solved this (`SolanaTopupService`, `SOLANA_NEW_WALLET_TOPUP_SOL`). Base
     and BNB Chain would each need their own equivalent (separate funding keypairs, since
     ETH-on-Base and BNB are different assets) — not automatically covered by extending the
     Solana version, a genuinely new (if mechanically similar) piece per chain.
   - **Appearance/theming.** `privyConfig` has no `appearance` block today — Privy's modal
     currently renders with default/unbranded styling even for the live Solana flow.
     Matching the Void theme is real, new config (Privy documents an `appearance` option
     for accent color/logo/theme) — worth doing for Solana too while this is being touched,
     not just the new EVM path.
   - **Coexistence with existing wagmi-linked wallets.** Users who already linked a
     wagmi-connected EVM wallet (and any trade history under it) need a real answer for
     what happens when Privy embedded wallets become available too — offered as an
     *additional* option alongside wagmi (matching how Solana's Privy integration is
     additive to wagmi, not a replacement), or eventually the sole path? Not decided here;
     flagging that "seamless… without manual extension popups" as stated implies eventually
     favoring Privy as primary, which is a real product decision, not just an engineering
     one.
   - **"Seamless" ≠ zero signing steps.** Privy's embedded wallet still requires the user to
     approve each transaction inside Privy's own modal — the same non-custodial signing
     step Solana already has, just without a browser extension. This is *not* the (still
     separately deferred, still-designed-but-inert) gasless relayer — conflating the two
     would mean the backend co-signing transactions, which is exactly the custody boundary
     docs/WALLET_SECURITY.md says to stop and reconsider before crossing. Keep these two
     ideas explicitly separate when this is eventually scoped for real.

## Sprint scope, as proposed (still contingent on the decisions above)

- **Launchpad ingestion worker** (`apps/api/src/tokens/`): a new ingestion path (worker or
  scheduled job, mirroring `apps/workers/src/market/ingestion.ts`'s existing pattern) that
  subscribes to Pump.fun's bonding-curve program on Solana and tracks Raydium/Uniswap pool
  creation as the graduation signal, feeding the three unimplemented `TrenchesCategory`
  values. Needs its own real research pass on Pump.fun's actual program ID, account layout,
  and whether it exposes a WebSocket/webhook feed or requires raw program-log subscription
  via Helius — not yet verified, don't assume either shape going in.
- **KyberSwap integration**: a new `KyberSwapRouter` implementing the existing `SwapRouter`
  interface (`apps/api/src/trading/router/swap-router.interface.ts`), wired into
  `MetaAggregatorSwapRouter` as a third parallel candidate — same shape as
  `OneInchSwapRouter`, not a new routing concept.
- Real-time trench feed out to the frontend via the same Redis pub/sub → SSE pattern already
  proven for the Solana activity feed (`SOLANA_ACTIVITY_REALTIME_CHANNEL`,
  `RealtimeService`) — a new channel, not new infrastructure.

## Why this isn't scoped for implementation yet

Pump.fun ingestion in particular needs real protocol research (program ID, account layout,
available data feeds) before any code gets written — the risk of building against guessed
account shapes is the same class of risk as guessing at an unverified aggregator API, just
on the ingestion side instead of the execution side. Resolve that research first; the
KyberSwap addition is comparatively mechanical once Pump.fun's shape is known, since it
follows an existing, proven pattern (`OneInchSwapRouter`) almost exactly.
