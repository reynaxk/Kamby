# Gas relayer implementation plan

**Status (2026-09-18): Solana relayer live in production; EVM relayer built (Piece
4a-4f) and inert pending funded testnet/mainnet verification (4g) and rollout (4h).** See
the "Solana" sections below for that relayer's full history (design → build → real
production incident → fix → live), and the "EVM" section below for the second relayer's
design and current status.

## Solana — live in production

Originally locked in 2026-09-13 as a deliberately-unwired, shovel-ready design. As of
2026-09-17's fee/1-click/gas-abstraction build (see
`C:\Users\admin\.claude\plans\flickering-imagining-twilight.md`, Piece 3), the previously
"still-undesigned" transaction-construction half was built, both HTTP routes went live, and
`GasRelayerService` was registered in `solana.module.ts`. On 2026-09-18 the devnet
adversarial pass in "Remaining work" below actually ran for real — 6/6 scenarios passed
against live devnet RPC, full log at `docs/devnet-adversarial-pass-2026-09-18.log`. Later
the same day, the relayer was funded and enabled in production for real — see "Operational
rollout" in "Remaining work" below for the full account, including a real fund-
misdirection incident found, reverted, and correctly re-fixed the same day. See
`docs/WALLET_SECURITY.md`'s "Solana" section for how this fits the platform's broader
"server never signs" principle, and why this is judged an acceptable, narrow,
heavily-guarded exception rather than a violation of it.

## Why this exists

Kamby's non-custodial Solana launch (confirmed working 2026-09-13) requires every user's
embedded wallet to hold its own SOL to pay network fees. That's a real UX gap against
competitors — FOMO, for example, sponsors gas fully and indefinitely via an ERC-4337-style
paymaster, so their users never need SOL/ETH/BNB at all. Kamby's one-time top-up
(`SolanaTopupService`) only ever softened the *first* trade, and isn't funded at launch
regardless (see the launch-readiness discussion this plan followed from) — it was never a
real answer to the gap. This plan is the real answer: ongoing gas sponsorship, the same
category of feature as FOMO's, done narrowly and safely.

## What's built

*(2026-09-13, the original co-signing design)*

- `apps/api/src/solana/gas-relayer-instruction-guard.ts` — pure, dependency-free instruction
  validation. Given an already-resolved instruction list, enforces:
  - Every instruction's program id is on a small, explicit allowlist (System, Compute
    Budget, SPL Token, SPL Token-2022, SPL Associated Token Account, Jupiter V6 — both its
    live program addresses).
  - Exactly one Jupiter route instruction must be present — not zero, not more than one.
  - `CloseAccount` handling — see "Security model" below; this rule changed 2026-09-17,
    see that section for the current behavior, not the original unconditional-rejection one.
- `apps/api/src/solana/gas-relayer-instruction-guard.spec.ts` — adversarial tests proving
  each rule actually rejects what it claims to, plus the required positive case (a
  well-formed swap passes) so the checks are proven not to be so strict they'd reject
  legitimate trades too.
- `apps/api/src/solana/gas-relayer.service.ts` — `GasRelayerService.submitSponsoredTransaction`,
  the co-signing half: given a transaction the user's wallet already partially signed (fee
  payer slot left for this service), validates it exhaustively (see "Security model"), then
  co-signs as fee payer and broadcasts.
- `apps/api/src/config/env.ts` — `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` and
  `SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING`, both genuinely optional even when
  `SOLANA_ENABLED` is true (unlike every other `SOLANA_*` var) — this is still true today,
  and is now the *only* thing keeping this inert on a real deployment (see "Status" above).

*(2026-09-17, the transaction-construction half + wiring — closes the original "What's NOT
built yet" gap below)*

- `apps/api/src/solana/jupiter-quote.service.ts` — new `getSwapInstructions()`, calling
  Jupiter's real `POST /swap/v1/swap-instructions` with a `payer` field set to the relayer's
  pubkey (verified live against production Jupiter, not assumed — see that method's own doc
  comment for the confirmed response shape).
- `apps/api/src/solana/gas-relayer-transaction-builder.ts` (new file) —
  `buildSponsoredSwapTransaction()` assembles Jupiter's raw instruction arrays into a real,
  unsigned `VersionedTransaction` with the relayer as fee payer (account index 0), resolving
  any address lookup tables first.
- `apps/api/src/solana/gas-relayer.service.ts` — two new public getters,
  `feePayerPublicKey`/`relayerConnection`, letting the quote-construction flow reuse this
  service's already-configured keypair/connection instead of re-parsing secrets or standing
  up a second RPC client.
- `apps/api/src/solana/solana-quote.service.ts` — new `createSponsoredQuote()` method,
  mirroring `createQuote()` but building via the relayer path above and persisting the
  result through the same `solanaTradeQuote` table (no schema change needed at the quote
  level — sponsorship is a transaction-level concept, see "Remaining work" below).
- `apps/api/src/solana/solana.module.ts` — `GasRelayerService` now registered as a provider.
- `apps/api/src/solana/solana.controller.ts` — two new routes, same `@Throttle({ limit: 20,
  ttl: 60_000 })` tier every other mutation here uses:
  - `POST /solana/quote/sponsored` — reuses the existing `SolanaQuoteDto`.
  - `POST /solana/transactions/sponsored` — new `SolanaSubmitSponsoredTransactionDto`
    (`apps/api/src/solana/dto/solana-submit-sponsored-transaction.dto.ts`), carrying the
    partially-signed transaction bytes (base64), not a bare signature string — nothing has
    been broadcast yet when this is called, unlike the ordinary submit route.
- `apps/api/src/solana/gas-relayer.service.spec.ts` (new file — this had zero coverage as of
  2026-09-13) — 21 tests using real `Keypair`/`VersionedTransaction` primitives, covering
  every gate, quote-matching, and idempotency/persistence independently.
- `apps/api/src/solana/solana-quote-match.ts` (new file) + `.spec.ts` (15 tests) — see
  "A second real gap, closed the same day" under "Security model" below.

**Confirmed wired, not yet enabled**: `GasRelayerService` is a real provider in
`solana.module.ts`, both `SolanaQuoteService` and `SolanaController` depend on it, and both
new routes are live. What keeps this inert today is purely
`SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` being unset in production — every sponsored-path
call fails fast with a clean `UnprocessableEntityException`, not a crash or a silent no-op.

## Transaction construction — history

**Closed as of 2026-09-17** — this used to describe `createSponsoredQuote()` as a
still-undesigned piece; it's now built exactly along these lines (Jupiter's real
`/swap-instructions` endpoint, verified live, confirmed to accept a `payer` field that
genuinely redirects which account funds setup instructions; `buildSponsoredSwapTransaction`
compiles the result via `TransactionMessage(...).compileToV0Message()`). See "What's built"
above for the file list. What's left is no longer "how is this transaction constructed" —
it's the operational and adjacent-logic gaps in "Remaining work" below.

## Security model

Ten numbered checks plus one live sub-check (6b), cheap-rejects-first, no RPC calls until
step 5. Renumbered 2026-09-17 alongside the WSOL-unwrap fix and the quote-match check below
— the code comments in `gas-relayer.service.ts` are the authoritative numbering; this list
mirrors them:

1. Deserialize the submitted bytes; reject anything malformed.
2. Re-derive the quote from the DB by id — never trust the client's claim about which quote
   this is for. Reject if it doesn't belong to the calling user, doesn't match the claimed
   wallet, or has expired.
3. Re-derive wallet ownership from the DB — reject unless verified and owned by the caller.
4. **Quote/transaction match** (`solana-quote-match.ts`, added 2026-09-17) — the submitted
   transaction's compiled message bytes must equal the persisted quote's own `unsignedTx`
   exactly (signatures excluded from the comparison). Closes a gap the instruction allowlist
   (step 8) can't: that allowlist only ever checks generic *shape*, never that this specific
   transaction is the specific trade the referenced quote id actually described — see "A
   second real gap, closed the same day" below.
5. Resolve every account the transaction actually touches, including through any address
   lookup tables (`connection.getAddressLookupTable` for each referenced table) — everything
   from here on depends on this being trustworthy.
6. The fee-payer slot (account index 0, by protocol convention) must equal this service's
   own configured relayer public key exactly. Refuses to sign a transaction sponsoring
   someone else's fee, or one where the slot isn't set up for sponsorship at all.
7. The user's own signer slot must already carry a real (non-zero-placeholder) signature —
   this relayer never signs first and never signs alone.
8. **Instruction allowlist** (`gas-relayer-instruction-guard.ts`) — the named, tested
   security core. As of 2026-09-17 this no longer rejects every `CloseAccount`
   unconditionally — see "The ATA rent-drain attack, specifically" below for why that
   turned out to be too strict (it broke legitimate Jupiter swaps) and what replaced it.
9. **(6b) WSOL-close freshness check** — a live `connection.getAccountInfo` call for every
   account the guard structurally permitted a close against, only reachable when a close was
   actually allowed at all (never on the common no-WSOL-involved path). Rejects if the
   account already existed before this transaction — closes the `CreateIdempotent` bypass
   the pure, synchronous guard can't catch on its own (see below).
10. Simulate the assembled transaction (`sigVerify: false`); reject on any simulation error.
11. **Hard balance-ceiling backstop** — defense in depth, not the primary control (step 8
    already rejects everything outside a narrow, matched allowlist; this exists in case that
    logic itself has a bug). Computed exactly via `connection.getFeeForMessage` for the real
    signature-fee cost plus `(ATA-create instruction count) × rent-exemption minimum` for the
    worst-case rent this fee payer could ever legitimately owe — still an exact worst-case
    bound even with a WSOL close now sometimes permitted, since a permitted close only ever
    refunds rent to the destination account (the user's wallet or the fee payer itself,
    never a third party), so it can only make the real net cost *lower* than this bound,
    never higher.
12. Only then: co-sign as fee payer, broadcast, and persist a `SolanaTradeTransaction` row
    (`sponsoredByRelayer: true`, `relayerFeePayer` set to this backend's own public key) —
    closed 2026-09-17; returns the same `SolanaTradeTransactionDto` shape the ordinary
    submit route does, through the same table, so history/status-polling/the global feed
    all treat a sponsored trade identically to a self-paid one. Idempotent on `quoteId`,
    checked before anything else in this method (including the "is this deployment
    configured" check) — a client retry never re-broadcasts or double-relays.

### A second real gap, closed the same day

The instruction allowlist (step 8) was written to answer "is this transaction *shaped* like
a safe swap" — an allowlisted program, exactly one Jupiter route instruction, no smuggled
rent-drain. It was never designed to answer a different question: "is this transaction
*the specific trade* the referenced quote id actually described." Those are genuinely
different properties — a transaction can pass every shape check while still being a
completely different swap (different mints, different amounts, a different or missing
platform fee account) than what the user reviewed and was quoted, simply by attaching it to
one of their own still-valid, unexpired quote ids. Since Jupiter's platform fee is embedded
*inside* the swap instruction's own opaque data (never separately verified by the allowlist),
a mismatched swap could in principle carry a different or absent fee entirely.

Found during the same review pass that produced the WSOL-unwrap fix, and closed the same
day: step 4 above (`solana-quote-match.ts`) compares the submitted transaction's compiled
message against the persisted quote's own `unsignedTx` byte-for-byte, which — because a
persisted Solana quote already *is* the entire unsigned transaction Jupiter or this
relayer's own builder produced — is a strictly complete answer to "is this really the trade
that was quoted," not merely a partial mitigation. See that file's own doc comment for the
full reasoning, and `gas-relayer.service.spec.ts`'s "quote/transaction matching" describe
block for the adversarial test proving a shape-valid-but-wrong-trade transaction is
rejected.

### The ATA rent-drain attack, specifically

Confirmed as a real, current, named risk directly by Privy's own documentation for this
exact sponsorship pattern (2026-09-13): on Solana, an Associated Token Account's rent
refund on close goes to the account's *owner*, not the transaction's fee payer.

**The original mitigation (2026-09-13) was too strict — a real bug, not just a gap.**
Rejecting every `CloseAccount` unconditionally would also have rejected every legitimate
Jupiter swap that unwraps a temporary wrapped-SOL account as normal cleanup — confirmed via
a live Jupiter API call (2026-09-17) showing a real `/swap-instructions` response whose
`cleanupInstruction` is exactly a `CloseAccount` targeting the swap's own temp WSOL account,
refunding the user. Fixed 2026-09-17 with a narrower, still-adversarially-tested rule: a
close is permitted only when *all* of — (a) its target matches an earlier same-transaction
ATA `Create`/`CreateIdempotent` instruction's target; (b) that creating instruction's own
mint equals the native SOL mint (never any other token); (c) the close's destination is the
fee payer or the user's own wallet, never a third party; (d) at most 2 such closes per
transaction. Because `CreateIdempotent` is a no-op against an *already-existing* account, a
purely structural same-tx-create check alone is bypassable — closed by 6b's live
pre-existence check above, run only against accounts the structural rule already narrowed
down to. Cost accounting still holds under this looser rule: every ATA-create's rent is
already priced into step 10's worst-case bound regardless of whether a close follows, so
permitting a provably-fresh, destination-restricted close is strictly better than the prior
worst case, never worse. See `gas-relayer-instruction-guard.ts`'s own doc comment and its
`.spec.ts`'s "WSOL-unwrap close exception" tests for the full adversarial coverage (fresh
close via `Create` accepted, fresh close via `CreateIdempotent` accepted, close to the
user's own wallet accepted, close to a third party rejected, close of a non-WSOL mint
rejected, a close referencing a later instruction rejected, a close matched only to
`RecoverNested` rejected, more than 2 closes rejected).

### The WSOL rent leak — found live in production, 2026-09-18 (two attempts, one real incident)

The gate above stops an *attacker* from draining rent via a smuggled close. It does not,
by itself, guarantee the relayer's own rent comes back — and in production, it didn't:
Jupiter's real `cleanupInstruction` unconditionally refunds a closed WSOL account's rent to
the *user's* wallet, correct for a self-paid swap (the user funded the create, the user
gets the refund) but a pure loss for a sponsored one, where the *relayer* is the one who
paid to create that account (`setupInstructions` are built with `payer: relayerPubkey`).
Confirmed by pulling the real, on-chain transaction for the first two gasless trades ever
run in production: the relayer's balance dropped by ~1.49M lamports beyond the real network
fee on *each* trade — traced to exactly this, not a Jito tip (the sponsored path has never
used Jito at all) and not network congestion.

**Attempt 1 (shipped and reverted the same day) — a real incident, not just a bug caught in
review.** `redirectWsolCloseToRelayer` rewrote a `cleanupInstruction`'s destination to the
relayer's own pubkey whenever it structurally matched an earlier relayer-paid WSOL
creation — reusing the exact same match `gas-relayer-instruction-guard.ts`'s own
WSOL-unwrap exception already requires (its `isAtaCreateInstruction`, exported for this).
It shipped, passed its own tests, and worked correctly on the very first real trade it
touched. **On the next real trade it did not**: that trade's actual output was native SOL
itself, and Jupiter routes a SOL *output* through the exact same kind of temporary WSOL
account used for a SOL *input* wrap — the account's balance at close time was rent *plus*
the user's real ~0.0088 SOL proceeds, and the redirect sent all of it to the relayer
instead of the user. Caught immediately by checking the actual on-chain balance delta
rather than assuming the fix worked because the deploy was healthy, reverted within
minutes (same-day revert commit, `docs` and code both), before any real user besides the
team's own test wallet was affected.

**Attempt 2 (the real fix) — gated on `outputMint`, not on instruction shape alone.** A
WSOL account only ever carries more than bare rent when it is the account the trade's
*final output* is delivered through — never otherwise, since any other WSOL usage
mid-route is a fully-consumed intermediate hop (confirmed live: two independently-observed
real SELL transactions each left *exactly* the rent-exemption amount in the account,
nothing more). `buildSponsoredSwapTransaction` now takes the trade's `outputMint`
explicitly (passed by `SolanaQuoteService#createSponsoredQuote`, which already computes it)
and only ever attempts the redirect when `outputMint !== SOLANA_NATIVE_MINT` — when the
output *is* native SOL, the redirect is skipped entirely and Jupiter's own default (refund
to the user) is left completely untouched, full stop, regardless of what the instruction
shape looks like. The structural match from attempt 1 is still there as a second,
narrower check on top of the gate — not a replacement for it. Since Kamby's Solana panel
currently only trades USDC ⟷ SOL, this means in practice: SELL gets the rent back, BUY
doesn't, until a real multi-pair Solana market makes "which side is SOL" a more nuanced
question than it is today.

8 tests in `gas-relayer-transaction-builder.spec.ts` (previously zero coverage), including
one specifically named for the regression: a WSOL close that structurally matches a
relayer-paid creation is *never* redirected when `outputMint` is native SOL, proven by
decoding the real compiled transaction back out — not asserting on the input, asserting on
what the chain would actually see.

## Remaining work before this can deploy

Reordered 2026-09-17 to reflect real progress — see
`C:\Users\admin\.claude\plans\flickering-imagining-twilight.md` (Piece 3) for the fuller
task breakdown this list summarizes.

- [x] Design and build the sponsored-transaction construction step — done, see "What's
      built" above.
- [x] Add `POST /solana/quote/sponsored` and `POST /solana/transactions/sponsored` to
      `solana.controller.ts`, same `@Throttle` discipline every other mutation here uses.
- [x] Register `GasRelayerService` in `solana.module.ts`.
- [x] Fix the CloseAccount/WSOL-unwrap collision (a real bug in the original design, not a
      missing feature) — see "The ATA rent-drain attack, specifically" above.
- [x] `gas-relayer.service.spec.ts` — was zero coverage as of 2026-09-13, now 21 tests using
      real cryptographic primitives, covering every gate plus quote-matching and
      idempotency/persistence independently.
- [x] **Persist a transaction row on sponsor.** `SolanaTradeTransaction` extended with
      `sponsoredByRelayer Boolean @default(false)` / `relayerFeePayer String?`
      (`20260917230000_gas_relayer_sponsorship`, applied to the local dev DB and verified),
      and `submitSponsoredTransaction` now writes the row and returns the full
      `SolanaTradeTransactionDto` — idempotent on `quoteId`, same P2002-recovery shape as
      `SolanaTransactionService#submitTransaction`. `@kamby/domain`'s
      `SolanaTradeTransactionSchema` gained the matching `sponsoredByRelayer` field so the
      frontend type stays in sync ahead of the 3f frontend work below actually consuming it.
- [x] **Instruction-level quote-match verification.** Closed 2026-09-17. New
      `apps/api/src/solana/solana-quote-match.ts` (`solanaTransactionMatchesQuote`) is the
      Solana analogue of `@kamby/domain`'s `transactionMatchesQuote` — simpler and strictly
      stronger, since a persisted Solana quote's `unsignedTx` is already the entire unsigned
      transaction, so comparing compiled message bytes directly (signatures excluded) fully
      captures "is this really the swap that was quoted." Wired into
      `GasRelayerService#submitSponsoredTransaction` as a pre-broadcast gate (before the
      instruction allowlist, before any RPC call) — closing a real gap the generic allowlist
      alone couldn't: that allowlist only ever checked *shape* (an allowlisted program,
      exactly one Jupiter instruction), never that the specific swap matches the specific
      quote id referenced, so a shape-valid-but-wrong-trade transaction riding on a caller's
      own valid quote id would otherwise have been sponsored. `SolanaTransactionService#refreshStatus`
      and `apps/workers/src/solana/solana-sweep.ts` deliberately still skip this for the
      self-paid path — not a remaining gap, see both files' own updated doc comments: a
      sponsored row can no longer be mismatched by construction (verified pre-broadcast
      above), and a self-paid row never involves the relayer's funds regardless.
- [x] **`SOLANA_GAS_RELAYER_ENABLED` boot-time flag.** Closed 2026-09-17. New env var
      (default false, `apps/api/src/config/env.ts`), gating
      `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY`/`SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING`
      behind a third `superRefine` — an *enabled*, misconfigured deploy now fails loudly at
      boot instead of silently staying inert. Also requires `SOLANA_ENABLED` itself, since
      "sponsorship on, Solana off" is nonsensical. Note: this flag is validation-only — it
      does not itself gate `GasRelayerService`'s runtime behavior, which (unchanged) is
      still driven purely by whether the fee-payer secret key is actually present. 5 new
      tests in `env.spec.ts`.
- [x] **Test-wallet rollout gate.** Closed 2026-09-18. New
      `SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES` (comma-separated addresses,
      `apps/api/src/config/env.ts`) — when set, `SolanaQuoteService#createSponsoredQuote`
      and `GasRelayerService#submitSponsoredTransaction` both refuse any wallet not on the
      list, with the exact same rejection message the "not enabled at all" case uses (never
      distinguishable from the outside). A rollout gate, not a security boundary —
      independent of `SOLANA_GAS_RELAYER_ENABLED`, never required. Exists specifically so
      the first live production cycle (see the item below) can be limited to the team's own
      wallet(s) before opening this to every user, per this plan's own recommendation.
      Removing the env var later is the entire "go live to everyone" step. 7 new tests
      across `env.spec.ts`/`solana-quote.service.spec.ts`/`gas-relayer.service.spec.ts`.
- [x] **Operational rollout — done for real, 2026-09-18.** Relayer funded (~$10 in SOL,
      deliberately small to start), `SOLANA_GAS_RELAYER_ENABLED=true` and
      `SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY` set on the `api` service,
      `SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY` set on `workers` for monitoring. Deployed
      without the test-wallet gate (an explicit choice — open to every user from the start,
      not gated to internal accounts first). **Two real gasless trades confirmed live on
      mainnet the same day** — a BUY and a SELL, both fully confirmed on-chain, the relayer
      genuinely co-signing and paying real SOL network fees on the user's behalf (see "The
      WSOL rent leak" above for the real cost investigation that followed). This is the
      "run live through real usage" proof the plan's own sequencing rule for Piece 4 asked
      for — still owed: an actual balance *replenishment* (a second top-up after this first
      real spend), to close the full spend-then-refill cycle, not just the spend half.
      Along the way, two unrelated but blocking production issues were found and fixed:
      production had never had `prisma migrate deploy` run for two pending migrations
      (`users.username`, `sponsored_by_relayer` — silently breaking trade recording
      entirely, gasless or not, until fixed), and `apps/api` was missing `multer` as a real
      dependency (only its types were declared, worked locally by accident via hoisting,
      crashed production outright). Both fixed and redeployed the same session.
- [x] **A periodic balance check.** Closed 2026-09-17. New
      `apps/workers/src/solana/treasury-balance-monitor.ts` (`checkTreasuryBalances`) covers
      *both* this relayer wallet and the existing Solana top-up wallet (which had no
      monitoring either — a separate pre-existing gap, closed the same time). Reads only
      public keys (`SOLANA_TOPUP_FUNDING_PUBLIC_KEY`/`SOLANA_GAS_RELAYER_FEE_PAYER_PUBLIC_KEY`,
      new workers-only env vars — never the secret keys apps/api holds for the same two
      wallets, since a balance read needs no signing capability); each wallet is
      independently opt-in and simply skipped if its public key is unset. Wired into
      `apps/workers/src/main.ts` as a new ticker (`SOLANA_TREASURY_MONITOR_INTERVAL_SECONDS`,
      default 300s), nested inside the existing `SOLANA_ENABLED` block so it reuses that
      block's own `Connection` rather than a second client. 5 new tests.
- [x] **A manual adversarial pass before this ever touches a real deploy.** Run for real
      2026-09-18 against live devnet RPC — **6/6 scenarios passed**. Full output:
      `docs/devnet-adversarial-pass-2026-09-18.log`. `apps/api/scripts/devnet-adversarial-pass.ts`
      (standalone, not wired into any build/lint/test config, gitignored `.devnet-keys/`
      directory for the two persistent keypairs it generates and funds via
      `solana airdrop`/the web faucet) constructs a real `GasRelayerService` pointed at real
      devnet RPC and calls `submitSponsoredTransaction` directly with real, hand-built
      `VersionedTransaction`s — no mocks, run from inside a container on the
      `savingourlife_default` Docker network (the established Prisma-on-Windows workaround)
      against the real local Postgres. Proved 6 of the plan's original scenarios for real:
      wrong fee-payer slot, unsigned user slot, quote/transaction mismatch (the 2026-09-17
      quote-match fix), a non-allowlisted program (the real, devnet-deployed Memo program),
      a smuggled `CloseAccount` with no matching creation, and — the marquee case —
      `CreateIdempotent` against a *genuinely pre-existing* devnet WSOL ATA (created via a
      real, separate, on-chain-confirmed setup transaction first, signature
      `NunD2cHB8DjkguMwf3p3eqGWYPU55gq1G5quJ9wJyrv6qre16DE7YnsBgFpmqTkJtw9Q4wyLTgJPThu5kjL9CJu`)
      then closed, proving live 6b catches what the structural guard alone can't. One real
      fixture bug found and fixed mid-run (the Memo scenario's instruction initially had
      `keys: []`, leaving no signer slot — the same mistake already caught once this session
      in `gas-relayer.service.spec.ts`'s own fixture, not a finding about the code under test).
      **A real, verified constraint narrowed this pass's scope**: Jupiter has no devnet
      deployment (confirmed live 2026-09-17 — `getAccountInfo` on
      `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` against `api.devnet.solana.com` returns a
      plain non-executable System-owned account, not a program), so nothing touching this
      relayer can ever successfully simulate on devnet. That ruled out 3 of the originally
      planned scenarios as achievable *for real* here: a genuine swap accepted and broadcast,
      a genuine same-tx WSOL close accepted, and the hard balance-ceiling rejection (checked
      *after* simulation in the real code, per `gas-relayer.service.ts`'s own step order).
      All three stay covered by `gas-relayer.service.spec.ts`'s 21 tests (real
      `Keypair`/`VersionedTransaction` primitives, a mocked `Connection`) — closing this
      residual gap for real needs either one tiny real mainnet trade or a devnet-deployed
      AMM Jupiter could route through, both disproportionate to what a devnet pass is for.
      The 6 scenarios that *were* covered here are exactly the ones where live RPC behavior
      could plausibly diverge from a mock's — the actual point of this pass, and now proven.
- [x] **Frontend.** Closed 2026-09-18. `lib/solana-trading-client.ts` gained
      `getSponsoredSolanaQuote`/`submitSponsoredSolanaTransaction`, mirroring the existing
      naming exactly. `SolanaTradePanel.tsx` gained a new opt-in `GaslessToggle` (new
      component, mutually exclusive with `JitoTipControl` — a sponsored transaction always
      broadcasts via the relayer's own RPC call, never through Jito, so the tip control is
      hidden entirely while gasless is on rather than showing a choice that would silently
      do nothing) — when on, the quote-fetch effect calls the sponsored endpoint instead,
      and confirm-and-sign calls a new `signOnlyForSponsorship` helper that reuses Privy's
      existing `useSignTransaction` hook (no second signing mechanism) and submits the
      partially-signed bytes to `submitSponsoredSolanaTransaction`. No separate
      "broadcast then record" two-phase flow needed here, unlike the self-paid path: since
      the relayer (not the client) broadcasts, and `submitSponsoredTransaction` is
      idempotent on `quoteId`, a failed submission can just land back on the review step
      with the real error shown — a plain retry (re-sign, resubmit) is always safe. 3 new
      tests in `SolanaTradePanel.test.tsx` (sponsored quote fetched instead of the normal
      one and Jito hidden; sign-only + correct submit call on success; the real error shown,
      not a stuck state, on failure).

## EVM — built (Piece 4a-4f), inert pending 4g/4h

**Status (2026-09-18): schema, config, core mechanics, the `/trade/relay` endpoint, the
fee-reimbursement leg, and the frontend are all shipped and deployed to production — but
`EVM_GAS_RELAYER_ENABLED` stays unset everywhere real, so none of it is reachable yet.**
Unlike Solana, this is a second relayer built from scratch (see
`C:\Users\admin\.claude\plans\flickering-imagining-twilight.md`, Piece 4, for the full
research and design writeup) — the two relayers share no code, only the same overall
custody discipline. See `docs/WALLET_SECURITY.md`'s "EVM" section for why this is a
different *kind* of exception than Solana's, not just the same one on a different chain.

### Why this is a genuinely different trust model, not "Solana again"

Solana's relayer *co-signs* — the user's own signature is physically present in the same
transaction, directly proving consent for that specific transaction. An EVM meta-transaction
relayer **submits the entire transaction with only its own signature** — the user never
signs the outer transaction at all. Two independently-established safety properties are
needed where Solana only needed one:

1. **No new custody** — established by calldata shape, verified directly against current
   code (not assumed from the original plan): `quote.service.ts:173` passes
   `taker: walletAddress` into the router; KyberSwap's calldata
   (`kyberswap-router.service.ts:204-205`) sets `sender`/`recipient` to that same address,
   not `msg.sender` — a relayer submitting the identical calldata as `from`/gas-payer gains
   zero new custody, since token movement is authorized entirely by the user's own standing
   `approve()` to the router contract.
2. **Real-time consent to *this specific quote*, right now** — has zero cryptographic proof
   unless something new provides it. An EIP-712 typed-data signature closes this gap — see
   "What's built" below.

### What's built

- `packages/db/prisma/schema.prisma` — `TradeQuote` extended with
  `sponsorshipRequested`/`relayerConsentSignature`/`relayerStatus`
  (`EvmRelayerQuoteStatus`: `PENDING_CONSENT` → `CONSENT_RECEIVED` → `BROADCAST`/`FAILED`)/
  `relayerNonce`/`relayerFailureReason`; `TradeTransaction` extended with
  `sponsoredByRelayer`/`relayerFeePayer`, mirroring `SolanaTradeTransaction`'s own two
  fields exactly. One migration (`20260918000000_evm_gas_relayer`), applied to production.
- `apps/api/src/config/env.ts` — `EVM_GAS_RELAYER_ENABLED`/`_PRIVATE_KEY`/`_CHAINS`/
  `_TEST_WALLET_ADDRESSES` plus **per-chain** `_MAX_GAS_PRICE_GWEI_<SLUG>`/
  `_MAX_WEI_CEILING_<SLUG>` (unlike Solana's single ceiling — Base/Arbitrum/BNB gas
  economics differ), validated in a fourth `superRefine` mirroring the Solana relayer's own
  pattern exactly (`ENABLED` decoupled from key-presence; allowlist independent of
  `ENABLED`). `getEvmGasRelayerConfig()` is the boot-safe accessor.
- `packages/chain-adapters/src/signature.ts` — `verifyEvmTypedDataSignature`, EIP-712
  alongside the existing EIP-191 `verifyEvmSignature`.
- `packages/domain/src/evm-relayer.ts` — `buildRelayedSwapTypedData` (the one function that
  builds the exact same typed-data object for both what the client signs and what the
  server verifies against, so the two can never independently drift), plus a JSON-safe wire
  form (`toWireTypedData`/`parseRelayedSwapTypedDataWire`/`RelayedSwapTypedDataWireSchema`)
  — a real bug caught and fixed during design: `bigint` cannot survive `JSON.stringify` at
  all, so the quote response's `value`/`chainId`/`expiry` fields are decimal strings over
  the wire, converted back to real `bigint` only for the actual signing/verification calls.
- `apps/api/src/trading/relayer/evm-relayer-nonce-manager.service.ts` — a hand-rolled
  promise-chain mutex per chain (no new dependency — the whole primitive is "run after
  whatever's currently at the front of the line finishes," which a plain promise chain
  already expresses). Serializes only *submission* order (read pending nonce → sign →
  submit), never confirmation order — multiple relayed trades can have transactions in
  flight in the mempool simultaneously as long as they were submitted in strict, gap-free
  order. Deliberately out of scope for launch: stuck-nonce recovery, speed-up/replacement-tx
  logic — acceptable only because the quote row's `relayerNonce`/`relayerStatus`/
  `updatedAt` carry enough for a human to manually diagnose a stuck sequence.
- `apps/api/src/trading/relayer/evm-relayer-wallet.service.ts` — one `{publicClient,
  walletClient, account}` triple per relayer-covered chain, with two deliberate design
  choices worth naming explicitly: (1) an explicit, hand-built `Chain` object is bound to
  both clients at construction — never left to viem's own implicit `eth_chainId`
  auto-detection, since this signs and broadcasts real transactions; (2) the wallet
  client's transport is plain `http(rpcUrl)`, **not** `createEvmTransport`'s
  fallback-capable transport every other caller in this codebase uses for reads — that
  helper's own doc comment is explicit that its "always retry the fallback, even past a
  real rejection" behavior is safe only because every existing caller is read-only; this is
  the first real caller that calls `sendRawTransaction`, where blindly retrying a broadcast
  against a second RPC endpoint (different mempool state, possibly already-accepted) is a
  materially different risk than retrying a read.
- `apps/api/src/trading/relayer/evm-gas-relayer.service.ts` — `simulate` (a pre-broadcast
  `eth_call` dry run, **as the relayer's own address**, not the user's — a user-perspective
  simulation could miss `msg.sender`-sensitive router logic), `checkGasCeiling` (a gas-price
  ceiling *and* an independent gas-units ceiling — a technically-successful-but-
  pathologically-expensive call would pass a price-only check), `broadcast` (nonce
  acquisition + sign + submit, serialized via the nonce manager above).
- `apps/api/src/trading/relayer/evm-gas-relayer-quote.service.ts` —
  `attachSponsorshipIfEligible` (wraps `QuoteService#createQuote`'s already-built response;
  computes a cheap `sponsorshipAvailable` boolean on *every* quote regardless of whether
  sponsorship was requested — split out specifically so the frontend can decide whether to
  even show a gasless toggle without a speculative extra request — and additionally attaches
  the EIP-712 object plus persists consent-tracking state only when actually requested) and
  `relay` (`POST /trade/relay`'s handler — verifies the EIP-712 signature against the
  persisted row, never anything the client echoes back; a concurrency-safe conditional
  update claims the row before any gas is spent; simulates; checks the ceiling; broadcasts;
  persists a real `TradeTransaction` row via the exact same `toDto`/P2002-idempotency
  machinery `TransactionService#submitTransaction` already uses for self-paid trades).
  19 tests, including two real end-to-end EIP-712 signature verifications (a genuine
  `viem` account signs, the genuine `verifyEvmTypedDataSignature` verifies — not a mocked
  boolean either direction).
- **Fee-reimbursement leg** (`EvmGasRelayerQuoteService#submitFeeLegIfDue`) — Option A,
  confirmed via explicit product sign-off 2026-09-18 (two relayer-submitted transactions,
  preserving the guaranteed-USDC-fee guarantee on both BUY and SELL, at roughly double the
  relayer's gas cost per sponsored trade). The rejected alternative (KyberSwap's own
  embedded `chargeFeeBy` fee mechanism — confirmed live and already used today for
  non-guaranteed-USDC markets, `kyberswap-router.service.ts:207-209`) was ruled out
  specifically because it charges the fee in the *input* token: that coincidentally
  preserves the guarantee for BUY (input is already USDC) but breaks it for SELL (input is
  the traded token) — a real, side-dependent product trade-off, not a wash.
  Broadcasts the fee transaction only after the swap's own `CONFIRMED` transition has
  already been observed for real — never speculatively — so a swap that ultimately reverts
  never triggers a fee charge for a trade that didn't happen. Triggered reactively from
  `TransactionService#getTransaction`'s existing on-demand status-refresh path, deliberately
  **not** from `apps/workers`' background sweep even though that sweep does the equivalent
  work for self-paid trades: `EvmRelayerNonceManagerService` only serializes broadcasts
  *within one process* — a second process (workers) broadcasting from the same relayer key
  would have no way to coordinate nonces with the API process and could race it. A
  concurrency-safe claim (mirroring the consent-claim pattern above) guards against two
  concurrent observers (e.g. two open tabs polling the same trade) both broadcasting the fee
  leg. **Named, not silently accepted, gap**: this only runs reactively, when something
  re-checks the row's status — a sponsored trade nobody ever re-checks after its swap
  confirms never has its fee leg submitted, the same gap the self-paid guaranteed-USDC flow
  already has today for an abandoned client-side fee submission. A periodic background
  backstop closing this for both flows is a deliberate follow-up, not built here.
- `apps/web/components/trading/TradePanel.tsx` — a `GaslessToggle` (the same component
  `SolanaTradePanel.tsx` uses, given a `label` prop instead of hardcoded "no SOL needed"
  text — Base/Arbitrum use ETH, BNB Chain uses BNB, so a single hardcoded token name would
  have been a real, wrong-token-name bug), rendered **only once a quote has confirmed
  `sponsorshipAvailable: true`** — invisible on every deployment today, since the relayer
  isn't enabled anywhere yet, rather than showing a toggle that would silently do nothing
  when switched on. Consent is signed via Privy's real `useSignTypedData` hook — verified
  against the actual installed package's type declarations (`SignTypedDataParams`/
  `TypedMessage`) before writing the call, not assumed from memory. Falls through
  unconditionally to the existing, completely unmodified self-paid flow whenever a quote
  isn't sponsorship-eligible. The separate guaranteed-USDC fee UI (`FeeTransferSection`)
  shows a passive "Kamby is sending the platform fee" message with no button for a
  sponsored trade, never the self-paid "Send platform fee" action (there's nothing for the
  client to sign in that case). 13 gasless-specific tests.

### Deployed, still fully inert — the same operational pattern as Solana's own rollout

Deployed to production 2026-09-18 (`git` commit `c31d9f4`; Railway `api` + Cloudflare
`kambesh.com`). One real, live-caught incident during that deploy, fixed the same session
and worth recording here as precedent: Prisma selects every column of a model by default,
so deploying the API with the new `TradeQuote`/`TradeTransaction` columns *before* running
`prisma migrate deploy` put every EVM quote/trade request at real risk of a `P2022` "column
does not exist" error — not just the new gasless path, the entire self-paid EVM flow too,
the same class of incident the Solana relayer's own rollout hit with its own missing
migrations. Caught before any real error was observed in production logs; the user ran the
migration within minutes of the deploy completing. **Sequencing lesson, worth restating for
whoever ships the next schema-touching deploy**: run the migration *before or immediately
alongside* the code deploy that depends on it, never treat "the app boots cleanly" as proof
the schema is caught up — a boot-time success only proves the app *starts*, not that every
query it will actually run once real traffic arrives is schema-safe.

### Remaining work

- **4g — the real adversarial pass.** Two tracks, since KyberSwap has no testnet at all
  (confirmed live against its own docs during planning — no Base Sepolia or any other
  testnet in its documented chain list):
  - **Track 1 (Base Sepolia, relayer mechanics only, no KyberSwap dependency)** — script
    ready: `apps/api/scripts/evm-relayer-adversarial-pass-base-sepolia.ts` (gitignored
    `.base-sepolia-keys/` directory, no database dependency at all — see the script's own
    header comment for exactly why Track 1's scope needs none). Blocked on funding: a fresh
    relayer keypair generated 2026-09-18, address printed to the operator, needs ~0.01 test
    ETH from a Base Sepolia faucet before the real scenarios (a genuine broadcast +
    on-chain confirmation, simulate catching an oversized-transfer revert with the
    relayer's real balance proven unchanged, the gas-ceiling gate rejecting an
    otherwise-legitimate transfer, 3 genuinely concurrent broadcasts cross-checked against
    real on-chain nonces, and the real EIP-712 sign/verify round trip including
    wrong-signer and tampered-message rejections) can run. Not yet funded as of this
    writing.
  - **Track 2 (Base mainnet, allowlist-gated, real tiny trades)** — the only way to prove
    the actual KyberSwap-routed path for real, since that dependency simply isn't deployed
    anywhere else. Needs its own explicit sign-off (real, if small, money deliberately at
    risk) before it runs — see the Piece 4 plan's "Decisions needing explicit sign-off" #6.
- **4h — rollout**: fund a real relayer key on the configured launch chain, set
  `EVM_GAS_RELAYER_ENABLED=true` with `EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES` populated
  from day one (learning directly from Solana's own sequencing, where the equivalent gate
  was added only *after* already going live to everyone once), wire a balance-monitoring
  alert, set final per-chain gas ceilings from 4g's real Track 2 data rather than guessing
  them in advance. Several decisions the plan names explicitly rather than resolves
  silently: which chain launches first (Base recommended), a shared vs. per-chain relayer
  key, exact ceiling values.

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
