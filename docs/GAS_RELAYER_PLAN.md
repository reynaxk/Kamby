# Gas relayer implementation plan

**Status: designed and coded, deliberately not deployed.** Locked in 2026-09-13, the morning
after a real end-to-end Solana trade first confirmed on-chain, specifically so this is
shovel-ready the moment there's real review time post-launch — not a rushed same-night
build under deadline pressure. See `docs/WALLET_SECURITY.md`'s "Solana" section for how this
fits the platform's broader "server never signs" principle, and why this is judged an
acceptable, narrow, heavily-guarded exception rather than a violation of it.

## Why this exists

Kamby's non-custodial Solana launch (confirmed working 2026-09-13) requires every user's
embedded wallet to hold its own SOL to pay network fees. That's a real UX gap against
competitors — FOMO, for example, sponsors gas fully and indefinitely via an ERC-4337-style
paymaster, so their users never need SOL/ETH/BNB at all. Kamby's one-time top-up
(`SolanaTopupService`) only ever softened the *first* trade, and isn't funded at launch
regardless (see the launch-readiness discussion this plan followed from) — it was never a
real answer to the gap. This plan is the real answer: ongoing gas sponsorship, the same
category of feature as FOMO's, done narrowly and safely.

## What's built (2026-09-13, not deployed)

- `apps/api/src/solana/gas-relayer-instruction-guard.ts` — pure, dependency-free instruction
  validation. Given an already-resolved instruction list, enforces:
  - Every instruction's program id is on a small, explicit allowlist (System, Compute
    Budget, SPL Token, SPL Token-2022, SPL Associated Token Account, Jupiter V6 — both its
    live program addresses).
  - Any `CloseAccount` instruction (Token or Token-2022) is rejected outright, unconditionally
    — the named mitigation for ATA rent-draining (see "Security model" below).
  - Exactly one Jupiter route instruction must be present — not zero, not more than one.
- `apps/api/src/solana/gas-relayer-instruction-guard.spec.ts` — adversarial tests proving
  each rule actually rejects what it claims to, plus the required positive case (a
  well-formed swap passes) so the checks are proven not to be so strict they'd reject
  legitimate trades too.
- `apps/api/src/solana/gas-relayer.service.ts` — `GasRelayerService.submitSponsoredTransaction`,
  the co-signing half: given a transaction the user's wallet already partially signed (fee
  payer slot left for this service), validates it exhaustively (see "Security model"), then
  co-signs as fee payer and broadcasts. Never constructs the transaction in the first place
  — see "What's NOT built yet" below.
- `apps/api/src/config/env.ts` — `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` and
  `SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING`, both genuinely optional even when
  `SOLANA_ENABLED` is true (unlike every other `SOLANA_*` var), specifically so this being
  unwired never risks today's deploy validation.

**Confirmed inert**: nothing imports `GasRelayerService` from `solana.module.ts`,
`solana.controller.ts`, or anywhere else; no route exposes it; its env vars are optional.
`git diff` against those three files is empty as of this plan being written.

## What's NOT built yet — the real next step

`GasRelayerService` only validates and co-signs a transaction that already exists with the
relayer as fee payer. **Building that transaction in the first place is a separate, still-
undesigned piece.** The current `JupiterQuoteService` calls Jupiter's `/swap` endpoint, which
defaults the fee payer to `userPublicKey` — the same account as the swap owner. Sponsoring
gas needs the fee payer to be a *different* account (the relayer's), which likely means:

1. Calling Jupiter's `/swap-instructions` endpoint instead of `/swap` (returns the raw
   instructions rather than a fully-assembled, fee-payer-defaulted transaction) —
   **unverified against Jupiter's current API; re-check `https://developers.jup.ag` before
   building this**, same caveat every Jupiter integration in this codebase already carries.
2. Assembling a new `VersionedTransaction` from those instructions with
   `MessageV0.compile({ payerKey: relayerPubkey, ... })`, explicitly including the user's
   wallet as a required (but not yet supplied) signer.
3. Returning that unsigned-by-anyone transaction to the client for the user to sign their
   own slot, then sending the partially-signed result to the new
   `submitSponsoredTransaction` endpoint (not yet added to `solana.controller.ts`).

This is real, scoped, estimable work — not a mystery — but it's a genuinely separate task
from what shipped 2026-09-13, and needs the same "verify against current docs, don't assume"
discipline as every other third-party integration here.

## Security model

Ten checks, cheap-rejects-first, no RPC calls until step 3:

1. Deserialize the submitted bytes; reject anything malformed.
2. Re-derive the quote from the DB by id — never trust the client's claim about which quote
   this is for. Reject if it doesn't belong to the calling user, doesn't match the claimed
   wallet, or has expired.
3. Re-derive wallet ownership from the DB — reject unless verified and owned by the caller.
4. Resolve every account the transaction actually touches, including through any address
   lookup tables (`connection.getAddressLookupTable` for each referenced table) — everything
   from here on depends on this being trustworthy.
5. The fee-payer slot (account index 0, by protocol convention) must equal this service's
   own configured relayer public key exactly. Refuses to sign a transaction sponsoring
   someone else's fee, or one where the slot isn't set up for sponsorship at all.
6. The user's own signer slot must already carry a real (non-zero-placeholder) signature —
   this relayer never signs first and never signs alone.
7. **Instruction allowlist** (`gas-relayer-instruction-guard.ts`) — the named, tested
   security core. Explicitly rejects any `CloseAccount` instruction regardless of context.
8. Simulate the assembled transaction (`sigVerify: false`); reject on any simulation error.
9. **Hard balance-ceiling backstop** — defense in depth, not the primary control (step 7
   already rejects the one known attack shape; this exists in case that logic itself has a
   bug). Computed exactly via `connection.getFeeForMessage` for the real signature-fee cost
   plus `(ATA-create instruction count) × rent-exemption minimum` for the worst-case rent
   this fee payer could ever legitimately owe — not an estimate, an exact worst-case bound,
   since the allowlist already guarantees no rent this fee payer pays is ever reclaimed
   (`CloseAccount` is rejected, so no refund path exists).
10. Only then: co-sign as fee payer, broadcast, and persist.

### The ATA rent-drain attack, specifically

Confirmed as a real, current, named risk directly by Privy's own documentation for this
exact sponsorship pattern (2026-09-13): on Solana, an Associated Token Account's rent
refund on close goes to the account's *owner*, not the transaction's fee payer. Without step
7's `CloseAccount` rejection, a client could smuggle a legitimate-looking swap that also
creates a throwaway ATA (which the relayer pays rent to create) and closes it in the same or
a later transaction, pocketing the rent refund — repeated many times, this drains the
sponsor wallet for free, one small theft at a time rather than one dramatic exploit. This is
exactly why the check is unconditional (rejects `CloseAccount` regardless of which account
it targets or what else is in the transaction), not merely "reject a *suspicious* close."

## Remaining work before this can deploy

- [ ] Design and build the sponsored-transaction construction step (see "What's NOT built
      yet" above) — needs Jupiter API verification first.
- [ ] Add `POST /solana/transactions/sponsored` (or similar) to `solana.controller.ts`, with
      the same `@Throttle` discipline every other mutation endpoint here already has.
- [ ] Register `GasRelayerService` in `solana.module.ts`.
- [ ] Fund a real relayer keypair, set `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` on Railway
      — small, manually replenished (~0.5–1 SOL to start), same "fund by hand, monitor the
      balance" operational model already used for the EVM platform-fee address and the
      Solana top-up funding wallet, not a new pattern.
- [ ] A periodic balance check (natural home: alongside `apps/workers/src/trading/sweep.ts`)
      logging `warn`/`error` below a threshold.
- [ ] **A manual adversarial pass before this ever touches a real deploy**: hand-craft a
      transaction with a smuggled `CloseAccount` instruction against a real devnet
      deployment and confirm it's rejected end-to-end, not just in the unit tests.
- [ ] Frontend: `SolanaTradePanel.tsx` needs a sponsored-transaction code path (build via the
      relayer's own quote/build flow, sign only the user's slot, submit to the new endpoint)
      — currently it only ever knows how to sign a transaction where its own wallet is *also*
      the fee payer.

## Explicitly out of scope for this plan

Raised alongside this same conversation and explicitly declined or deferred separately —
not part of what this document designs:

- Jito/Anti-MEV bundle submission — no integration exists; would be a second, separate
  design effort with its own real-money risk, not a corollary of this one.
- Pump.fun swap execution — a different on-chain program family (bonding curves, not AMM
  routing), never previously scoped for Kamby, and not part of "wiring up the core Jupiter
  pipeline" since that pipeline is already live and working.
- Caller-alpha / trending-tokens / live-positions features — see
  `apps/web/components/terminal/PreviewBanner.tsx` and the memory note this session left
  ([[solana-launch-scope]]) for what's mock-only preview vs. real.
