# Testing

## What exists as of Phase 3

| Package/app | Runner | What's covered |
| --- | --- | --- |
| `packages/domain` | Vitest | Zod schema round-trips; `parseEnv`'s error formatting; the Discovery Score formula and staleness gate (`market.test.ts`); EVM address validation/normalization (`wallet.test.ts`); activity-cursor encode/decode (including malformed input) and the Trending Score's gates/ordering (`social.test.ts`); EIP-4361 message construction (`wallet-auth.test.ts`); exact bps fee/min-output math, slippage-bounds validation, price-impact classification, quote-expiry, defensive `unsignedTx` parsing, and `transactionMatchesQuote`'s exact sender/destination/value/calldata matching — including case-insensitive address/calldata comparison and rejection of a contract-creation (`to: null`) transaction (`trading.test.ts`). |
| `packages/chain-adapters` | Vitest (unit) | `EvmChainDataProvider` and `uniswap-v3-math.ts`'s price/liquidity/market-cap math — the latter checked against real numbers observed on a live pool, not synthetic fixtures. `verifyEvmSignature` (`signature.test.ts`) against **real** ECDSA signatures from a well-known test keypair — valid/tampered/wrong-address/malformed all covered, never mocked crypto. `getTransactionDetails` returns `null` (never fabricated) when the RPC is unreachable. |
| `packages/chain-adapters` | Vitest (**live** integration) | `UniswapV3PoolReader` against the real Base mainnet RPC and a real, live Uniswap V3 pool, including that a failed `eth_getLogs` call returns `null` (never a fabricated `[]`) and that `sender`/`recipient` decode correctly for trader identity — see below. `EvmChainDataProvider#getTransactionDetails` (`evm-adapter.integration.test.ts`) against a real, recently-mined transaction, proving the sender/destination/calldata decode actually works against a real transaction — the read Phase 3's transaction-integrity check depends on. |
| `apps/workers` | Vitest | Env schema validation; `MarketIngestionService#ingestSwaps` (mocked Prisma + mocked `UniswapV3PoolReader`) — cursor-advancement safety on an RPC failure vs. a genuine empty result, wallet upsert ordering (before the swap that references it), trader-vs-sender attribution, the realtime Redis ping (and that its failure doesn't fail the tick), and the 24h rollup decay/null-vs-zero rules including the Phase 2 activity stats. `TradeSweepService` (`sweep.test.ts`) — confirmed/failed/left-pending/expired transitions, chain-id scoping, that one bad row's RPC error never aborts the rest of the batch, and — independently from `apps/api`'s own check — that a successful receipt whose on-chain details don't match the persisted quote is marked FAILED, never CONFIRMED. `PnlLedgerSweepService` (`pnl-ledger-sweep.test.ts`, mocked Prisma) — correct lot pricing, FIFO matching, the null-price/no-decimals skip path, the Solana USDC-anchor invariant, and that one bad row never aborts the batch. |
| `apps/workers` | Vitest (**live DB**) | `pnl-ledger-sweep.e2e-spec.ts` — a real CONFIRMED BUY then a real CONFIRMED partial SELL, seeded directly via Prisma against a real Postgres, swept by the real `PnlLedgerSweepService` (real `pg_advisory_xact_lock` path included), then read back through the exact `realized_pnl_events` GROUP BY/aggregate shapes `LeaderboardService#getLeaderboard` and `TraderService#computeRealizedPnl` (`apps/api`) use — proving the whole pipeline's numbers are correct end to end, not just each piece's mocked-Prisma unit test. See "Running tests locally" below for how to run this against Docker Desktop on Windows. |
| `apps/api` | Jest (unit) | Env schema validation (including `JWT_SECRET` and Phase 3's chain/aggregator/fee vars); the global exception filter's production-vs-development behavior; `IdentityService` token issuance/verification. `WalletService` — challenge issuance, verification with real signatures (valid/wrong-account/tampered), single-use nonce consumption (including the concurrent-double-verify race), expiry, and cross-session rejection. `SafetyService`/`QuoteService`/`KyberSwapRouter` — wallet-ownership gating, input validation, honest quote-unavailable handling, the provider-slippage-floor sanity check, fee sourcing (server config only, never the request). `TransactionService` — submission idempotency on both `quoteId` and `(chainId, txHash)`; status refresh driven only by a real receipt; expired-quote rejection at submission; wallet re-verification at submission (unlinked, re-verified to another account, or verification cleared); on-chain sender/destination/value/calldata match enforced both at submission (best-effort) and before every CONFIRMED transition (authoritative) — see docs/TRADING.md#transaction-integrity. |
| `apps/api` | Jest (e2e) | `GET /health`, the full `/market`, `/social` + `/identity`, and `/trade` route families — session issuance, activity pagination, trader profiles/404s, follow/like idempotency, wallet challenge/verify/list/unlink with real signatures (including replay protection, cross-user rejection, and challenge rate-limiting — run against an isolated app instance, see below), quote/transaction authorization boundaries, an honest 422 in place of a fabricated quote, transaction idempotency, trade-history scoping (including the global `ValidationPipe` rejecting an unrecognized `?userId=` outright), expired-quote and unlinked-wallet submission rejection, and — using real, live, already-successful Base mainnet transaction hashes fetched at test time — that an unrelated transaction can neither be submitted against a quote it doesn't match nor ever reach CONFIRMED for one, all against a **live** Postgres and Redis. See below. |
| `apps/web` | Vitest | `lib/env.ts`'s validation (server, client, and Phase 3's chain/WalletConnect vars); `lib/format.ts`'s formatting; `lib/session-client.ts` (token persistence, error-message parsing preferring the API's own message); `lib/wallet-client.ts`/`lib/trading-client.ts` (request shape, 404-as-null for transaction lookups); component tests for `ActivityCard`, `FollowButton`, `ActivityFeed`, `ActivityFeedTabs`, `ConnectWalletButton` (mocked wagmi — connect/disconnect/wrong-network/switch-chain), `SlippageControl` (bounds enforcement), and `QuoteSummary` (renders exactly what's in the quote, including price-impact/approval warnings, never a "safe" claim). |
| `packages/db` | — | No unit tests; correctness is verified by CI actually applying every migration (see below), not by mocking Prisma. |

## Running tests locally

```bash
pnpm test          # every package's unit tests, via Turborepo
pnpm test:e2e      # @kamby/api's e2e suite, via Turborepo — requires docker compose up -d first
pnpm --filter @kamby/workers test:e2e # apps/workers' own e2e suite — same, real Postgres, see below
```

The e2e suite boots the real `AppModule`, so it needs a reachable `DATABASE_URL` and
`REDIS_URL` (`docker compose up -d` provides both locally with the defaults in
`apps/api/.env.example`). It isn't part of `pnpm test` for that reason — it's a separate,
explicit step both locally and in CI. `pnpm test:e2e` (root script, `turbo run test:e2e
--filter=@kamby/api`) is the one CI actually runs — going through turbo, not a bare `pnpm
--filter @kamby/api test:e2e`, matters: turbo's `^build` dependency graph builds `@kamby/db`/
`@kamby/domain` first, and its task-scoped `env` allowlist is what actually gets
`DATABASE_URL`/`REDIS_URL`/etc through to the child process (see the 2026-09-26 CI incident
below). A bare `pnpm --filter @kamby/api test:e2e` still works for local use since it doesn't
go through turbo's env stripping at all, but won't catch a missing `@kamby/db`/`@kamby/domain`
build the way CI's real invocation does.

`apps/workers`' own e2e tests (`**/*.e2e-spec.ts`, run via a dedicated
`vitest.e2e.config.ts` — see its own comment) follow the exact same naming/split
convention as `apps/api`'s Jest e2e specs specifically so the default `vitest run`'s
include glob (`*.test.ts`/`*.spec.ts`) never picks them up by accident; they need the same
reachable `DATABASE_URL` (workers doesn't touch Redis directly for this test).

### Local Postgres on Windows (Docker Desktop)

Connecting to the local `docker compose` Postgres container **from the Windows host
directly** (Prisma, the plain `pg` driver, `migrate deploy`, a test runner — all of them)
fails with a generic "password authentication failed" even with the exactly correct
credentials. This is a real Docker Desktop for Windows bug, not a credentials or
auth-method problem — confirmed by testing both `md5` and `trust` (zero round-trips after
the startup packet) with the identical failure either way, and by confirming the same
credentials work fine from *inside* the container or from a second container on the same
Docker network (neither goes through the broken host-port-forwarding proxy). See
`docker-compose.yml`'s own comment on the `postgres` service for the full diagnosis.

**The fix:** run anything that needs a real DB connection from inside a throwaway
container on the same Docker network instead of from the Windows host:

- For just the Prisma CLI (a migration, `db pull`, etc.) — mount `packages/db` and install
  `prisma` fresh inside the container; see the exact command in `docker-compose.yml`'s own
  comment. Use `node:20`, not `node:20-alpine` (the alpine tag is a moving target and has
  been observed to break Prisma's OpenSSL detection between pulls).
- For a real test run needing the *whole* workspace's `node_modules` (not just prisma) —
  don't bind-mount the host's own `node_modules`: several native deps (esbuild/vite among
  them) ship OS-specific binaries, and the host's are Windows ones, incompatible inside a
  Linux container. Instead bind-mount the repo **read-only**, `cp` it into the container's
  own filesystem, strip any copied `node_modules`, then run a fresh `pnpm install` inside
  the container — this produces a real Linux-native `node_modules` without ever touching
  the host's own copy. Run all of this from PowerShell, not git-bash — MSYS's automatic
  Unix-path-to-Windows-path rewriting mangles `-v`/`-w` arguments containing `/`.

## The live-RPC integration test

`packages/chain-adapters/src/uniswap-v3.integration.test.ts` is deliberately not mocked —
it calls the real Base public RPC and reads the real WETH/USDC pool
(`0x6c561B446416E1A00E8E93E221854d6eA4171372`), asserting the decoded tokens, fee tier, and
recent Swap events are what they actually are on-chain. This is the one place proving the
ABI encoding/decoding is correct against a real contract rather than a fixture the same
person who wrote the reader also wrote. It needs outbound network access; if you're
offline, skip it with `vitest run --exclude '**/*.integration.test.ts'`.

## Migration verification

There's no live database in every environment this project gets built in, so migration
correctness isn't "trust me" — CI applies the actual migration SQL (Phase 0's, Phase 1's,
Phase 2's, and Phase 3's) to a real, disposable Postgres+Timescale service container on
every run (`prisma migrate deploy`, see `.github/workflows/ci.yml`) before running the e2e
suite against it. If a migration is broken, CI fails there, not later. Phase 1's migration
also converts `candles` into a real Timescale hypertable (`create_hypertable`) as part of
that same file — see `packages/db/prisma/migrations/20260904130000_market_data/migration.sql`.
Phase 2's migration (`20260906120000_social_layer`) is plain tables/columns, no hypertable
work — every new/altered column is nullable, so it applies cleanly against a database that
already has Phase 1 data in it. Phase 3's migration (`20260906180000_wallet_trading`) drops
`users.wallet_address` (always `null` in every real Phase 2 deployment — see
`docs/SOURCE_OF_TRUTH.md`) and adds the wallet-ownership/trading tables; every new column on
an existing table is nullable, so it too applies cleanly on top of live Phase 1/2 data.
**Not re-verified locally against a real database in this build's sandbox** — no Docker was
available to run `docker compose up -d`, no Redis was reachable, and the one native
Postgres install present had credentials this session didn't know. Migration correctness
for Phase 3 rests on the same CI step described above, not on a local run — flagged
honestly here rather than claimed as verified.

## What actually caught bugs during development

Worth recording, since it's the point of testing rather than a formality:

- The swap-ingestion price calculation initially hardcoded the quote token's decimals as
  `18` — correct for WETH, silently wrong for USDC (6 decimals). Caught by re-reading the
  code with the same rigor as the audit process, before it ever ran, not by a test — noted
  here because it's exactly the class of bug the unit tests for `uniswap-v3-math.ts`
  exist to catch for the *math*, even though this particular one was in the *wiring*
  around it.
- Two of the price-math test fixtures themselves had bugs (a rounding mismatch from
  reconstructing a raw balance from a display-rounded string, and a missing group of zeros
  in a raw-amount literal) — caught by the tests failing on first run, exactly as
  intended, then fixed before trusting the "passing" result.
- The worker's Redis connectivity check had no error handling, unlike the parallel
  Postgres check — an unreachable Redis at boot crashed the whole worker process instead
  of reporting degraded status. Found by actually running the compiled worker against an
  unreachable Redis, not by inspection (this was a Phase 0 bug, fixed during the Phase 0
  audit, but recorded here because it's the same "actually run it" principle this section
  is about).
- `apps/web`'s "Last updated" timestamp used `Date.prototype.toLocaleString()` with no
  locale argument, which renders however the *host process's* locale happens to be set —
  it showed a Russian-locale timestamp in one environment during a real browser check.
  Every other formatter in `lib/format.ts` already passed `'en-US'` explicitly; this one
  didn't. Fixed, and `format.test.ts` now has a regression test asserting the exact
  `en-US` output for a fixed input date, specifically so a locale-dependent formatter
  can't reappear silently.

## What Phase 2 caught during development

- `@nestjs/jwt@12` (the latest at the time) ships an ESM build; Jest's default CJS
  transform couldn't load it (`Cannot use import statement outside a module`). Pinned to
  `^10.2.0`, the release aligned with this project's Nest v10 — caught immediately by
  `pnpm --filter @kamby/api test` failing to even parse, not a runtime surprise.
- `ActivityFeed` was first written taking a `fetchPage` function as a prop, set by the
  Server Component page that renders it. Server Components cannot pass a function to a
  Client Component — React strips it at the RSC boundary. Caught before it shipped by
  re-checking the design against React's actual constraints, not by a failing test (no
  test would have caught this short of an actual `next build`/render, which does pass); a
  serializable `scope` discriminator (`{ type: 'global' | 'token' | 'trader' | 'following',
  address? }`) replaced it, with the component choosing the right `lib/social-client.ts`
  fetcher internally.
- A Server Component page render can never see the browser's session (it lives in
  `localStorage`, never a cookie), so `TraderProfile.isFollowedByMe` from a server-rendered
  fetch is `null` on every real page load, not just for a genuinely unauthenticated visitor.
  `FollowButton` originally trusted that prop outright, which meant it always rendered
  "Follow" even for someone already following. Fixed by having the button resolve the real
  state client-side after mount (`checkFollowStatus`), using whatever session the browser
  already has, without creating a new one just to check.
- The "Following" feed's API endpoint and the `ActivityFeed` component's support for it
  both existed before any page actually rendered a way to reach it — "return to a
  personalized feed" (one of Phase 2's own success criteria) wasn't reachable from the UI
  at all. Caught by re-reading the success criteria against what was actually wired into
  `apps/web/app/page.tsx`, not by a test (nothing was broken — a real feature was simply
  unused).
- `apps/web`'s `jsdom` devDependency, added unpinned, resolved to `^30.0.1`, which pulls in
  an `undici` version calling `webidl.util.markAsUncloneable` — an API not present in CI's
  Node 20 (it worked locally under a newer Node). Pinned to `jsdom@25.0.1`. Not caught
  locally, since nothing in this environment runs CI's exact Node version — a real gap in
  local verification for a devDependency version bump specifically, worth remembering.
- `social.e2e-spec.ts`'s trader address fixture was 38 hex characters, not 40 — the exact
  same mistake `819746b` fixed in `market.e2e-spec.ts` during Phase 1, this time in a fresh
  file. `AddressParamDto` correctly rejected it as malformed (400), which cascaded into
  eight failing assertions across follow, like, trending, and top-traders tests that all
  depend on that one address resolving. Caught only by CI (this sandbox has no live
  Postgres to run e2e locally) — worth generating fixture addresses programmatically
  (`'1'.repeat(40 - tail.length) + tail`) rather than hand-typing hex strings, given this is
  now a repeat mistake.
- `social.e2e-spec.ts` originally reused `market.e2e-spec.ts`'s exact chain/token/pool
  fixture addresses. Jest runs e2e spec *files* in parallel by default (no `maxWorkers`
  config), and both suites share one live database — the two `afterAll` hooks raced to
  delete the same `tokenMarket` row, and mid-test queries in one file intermittently saw
  rows the other file's `beforeAll`/`afterAll` was concurrently creating or deleting.
  Fixed at both levels: `social.e2e-spec.ts` now uses fixture addresses distinct from every
  other e2e spec, and `jest-e2e.json` sets `maxWorkers: 1` so e2e spec files never run
  concurrently against the shared database again, regardless of what future spec files add.
- Vitest's default esbuild JSX transform doesn't treat Next's `"jsx": "preserve"` tsconfig
  setting as the automatic runtime, so component tests failed immediately with `React is
  not defined`. Fixed with an explicit `esbuild: { jsx: 'automatic' }` in
  `apps/web/vitest.config.ts`. Similarly, `@testing-library/react`'s automatic
  `afterEach(cleanup)` only registers when it finds `afterEach` on `globalThis`, which
  requires Vitest's `globals: true` — this project imports test helpers explicitly instead
  (matching every other package), so tests leaked DOM state across cases (`getByRole`
  matching multiple buttons) until `vitest.setup.ts` called `cleanup()` explicitly.

## What Phase 3 caught during development

- `apps/api` never had `@kamby/chain-adapters` as a declared dependency — Phase 1/2 only
  used it from `apps/workers`. `WalletService` (signature verification) and
  `TransactionService` (receipt reads) both need it directly; `pnpm typecheck` failed with
  `Cannot find module '@kamby/chain-adapters'` immediately, before either service was ever
  exercised at runtime.
- A quote/transaction-fixture test private key one character short of 64 hex chars
  (`invalid private key, expected hex or 32 bytes, got string`) — the same class of mistake
  `docs/TESTING.md` already recorded for hand-typed EVM *addresses* in Phase 2, this time in
  a hand-typed *private key*. Replaced with `generatePrivateKey()` rather than another
  hand-typed literal, so this specific mistake can't recur in this file.
- The same malformed-hex-length mistake showed up a third time, in a `PLATFORM_FEE_RECIPIENT_ADDRESS`
  test fixture reused verbatim from an existing repo-wide test address that happened to be
  38, not 40, hex characters everywhere else it appears (those other call sites never
  validate address *length* strictly, so it went unnoticed there) — caught only here because
  `PLATFORM_FEE_RECIPIENT_ADDRESS` is the first field in this codebase with a real regex
  requiring exactly 40 hex characters. Fixed in both `env.spec.ts` and `ci.yml`, without
  touching the other, non-length-sensitive call sites.
- Adding `quoteAddress`/`quoteDecimals` to `MarketSummary` and `SocialActivity.token`
  (needed so the trading UI can request a quote without a second round-trip) is additive at
  the schema level, but three existing `apps/web` component test fixtures constructed those
  shapes as full object literals and failed to typecheck once the new required fields
  existed — a reminder that "additive" at the database layer still means "find every
  hand-written fixture" at the type layer.
- `wagmi/connectors`' barrel file unconditionally re-exports a `coinbaseWallet`/`baseAccount`
  connector that pulls in `@coinbase/cdp-sdk`'s optional payments code, which statically
  imports `@x402/*` packages this app never installs. Not calling `coinbaseWallet()` doesn't
  help — ES module imports are resolved for the whole file graph before tree-shaking runs —
  so `next build` failed with `Module not found` even though the connector was never
  constructed. Fixed with a targeted `webpack.IgnorePlugin` in `next.config.mjs`; caught only
  by actually running `next build`, not by lint or typecheck (both passed cleanly first).
- A `quote.service.spec.ts` assertion compared `expiresAt - createdAt` for exact equality
  against `quoteTtlSeconds * 1000`, but the two timestamps come from separate `Date.now()`
  calls a few lines apart in the mocked test setup — an occasional 1ms real-clock drift
  failed the test nondeterministically. Fixed with a small tolerance instead of exact
  equality.
- **The original `trading.e2e-spec.ts` rate-limit test broke the rest of the file.**
  `POST /identity/wallet/challenge` is throttled to 10/60s; the test fired 12 requests at it
  to prove a 429 eventually appears, sharing the *same* `app` instance (and so the same
  in-memory throttler bucket) as roughly 15 other calls to that same route elsewhere in the
  file (mostly via the `linkVerifiedWallet()` helper nearly every quote/transaction test
  depends on). Once the rate-limit test ran, that bucket stayed over its limit for the rest
  of the file's 60-second window, so every later `linkVerifiedWallet()` call would have
  started 429ing instead of succeeding — the test wasn't just testing the limit, it was
  quietly consuming a shared resource every other test needed. Fixed by moving it into its
  own top-level `describe` block with a dedicated Nest app instance (its own throttler
  storage) — production throttling config is untouched; only the test's blast radius is
  contained. Caught by re-reading what the test actually shares with the rest of the file,
  not by a failure in this sandbox (no live Postgres/Redis here to run it against).
- **A receipt's "success" status was being treated as sufficient to confirm a trade**, in
  both `TransactionService#refreshStatus` and `apps/workers`' independent sweep — neither
  checked that the transaction's actual on-chain sender, destination, value, and calldata
  matched the quote it was being confirmed against. An arbitrary, unrelated, but genuinely
  successful transaction hash (a user's own past transaction, or any public one) could have
  been submitted and, once mined, would eventually have been marked CONFIRMED — fabricating
  a trade that never happened as quoted. Also found: `submitTransaction` never re-checked
  quote expiry or current wallet-verification status, both frozen at quote-creation time.
  Fixed with `transactionMatchesQuote` (`packages/domain/src/trading.ts`) and
  `EvmChainDataProvider#getTransactionDetails` — see docs/TRADING.md#transaction-integrity.
  Not caught by any existing test (the existing unit tests mocked the receipt call and never
  modeled a *wrong* transaction behind a real hash); found by an explicit security audit of
  `submitTransaction`/`refreshStatus` against the original non-custodial requirements.

## What the 2026-09-26 CI investigation caught

The "API e2e tests" CI step had been failing on **every run since commit `e27a35f`** — 41
consecutive red runs across three weeks of otherwise-shipped work, never once investigated.
Three compounding causes, each masking the next until fixed in order:

1. `test:e2e` was never declared as a Turborepo task, so `ci.yml`'s `pnpm --filter @kamby/api
   test:e2e` bypassed the `^build` dependency graph every other task relies on — `@kamby/db`/
   `@kamby/domain` were never built first, so Jest failed at `Cannot find module '@kamby/db'`
   before running a single test.
2. Once wired in as a real turbo task, its lack of a declared `env` array meant turbo stripped
   `DATABASE_URL`/`REDIS_URL`/`JWT_SECRET`/etc from the child process — invisible until then
   because no other task (`build`/`typecheck`/`generate`) actually reads runtime env vars.
3. `ci.yml`'s own env block still set the pre-multi-chain variable names (`CHAIN_ID`,
   `CHAIN_RPC_URL`, `USDC_CONTRACT_ADDRESS`) — dead since the env schema moved to per-chain
   `CHAIN_BASE_ID`/`CHAIN_BASE_RPC_URL`/`CHAIN_BASE_USDC_ADDRESS`. Nobody had noticed because
   the suite never got far enough to hit env validation until fixes 1 and 2 landed.

Fixed by declaring `test:e2e` in `turbo.json` (with its own `env` allowlist and `cache: false`
— e2e tests hit live, stateful Postgres/Redis and must never replay a cached result from
different DB state) and correcting `ci.yml`'s env block. Reproduced and verified the whole
fix locally first, in Docker, against an isolated Postgres/Redis matching CI's exact config —
see [[kamby_ci_e2e_chronic_failure_fixed]] for the full reproduction recipe (a real, non-obvious
Windows/Docker technique worth reusing).

**Once actually running, the suite immediately caught a real, separate, production bug**:
`ActivityService.getGlobalFeed` filtered `tokenMarket.chainId` against the raw numeric EVM
chain id (8453) directly, but `TokenMarket.chainId` is Chain's own internal Prisma
autoincrement row id — never that number. Any `tokenAddress`-scoped social activity query has
been silently returning empty results in production. Same bug class `identifierForChainId`'s
doc comment (`packages/domain/src/chain-registry.ts`) already tracks an incident list for; the
existing unit test had been asserting on the buggy `chainId: 8453` shape directly, which is
exactly why it was never caught there.

**A second, unrelated flake surfaced in the same push**: `apps/web`'s Vitest suite (`pnpm
test`, run via turbo across all 8 packages concurrently) started failing 6 tests at exactly
Vitest's 5000ms default timeout (`SendModal.test.tsx`, `TokenTradersPanel.test.tsx`) — both
pass reliably in isolation (slowest individual test: 2.8s). Not a hang, just `userEvent`'s
realistic per-keystroke typing delays leaving too little margin once turbo's concurrent
cross-package load adds any real contention. Fixed with `testTimeout: 15_000` in
`apps/web/vitest.config.ts`.

**Deliberately left open**: `apps/workers` has its own e2e suite (`pnl-ledger-sweep.e2e-spec.ts`)
that turbo also discovered once `test:e2e` existed as a task — it has the same `DATABASE_URL`
passthrough failure as `@kamby/api`'s did, but was never wired into `ci.yml` at all, so it has
never run in CI, ever. `ci.yml`/the root `test:e2e` script were deliberately scoped to
`--filter=@kamby/api` to fix the actual CI step without silently expanding what CI covers —
whether workers' e2e suite should join CI (and get its own env-allowlist fix) is a real, still-
open decision, not an oversight in this fix.

## What's deliberately not tested yet

Within Phase 2: comments, reposts, and bookmarks have no tests because they aren't
implemented (see `docs/SOCIAL.md`'s known limitations); the notification module remains
the empty boundary it was in Phase 0/1. `MarketIngestionService`'s Redis publish path is
tested for "doesn't fail the tick," not for the Redis client's own reconnect behavior —
that's `ioredis`'s contract, not this codebase's, same reasoning Phase 0 applied to the
health-check Redis client. Adding tests ahead of the feature they cover is its own kind of
premature complexity.

Within Phase 3 (see `docs/TRADING.md#known-limitations` for the full list): no test
exercises a real WalletConnect mobile-pairing session (the connector is wired but requires
an external project id this environment doesn't have); no test verifies an ERC-1271
smart-contract wallet signature (the adapter deliberately doesn't support one yet, and
correctly 401s rather than silently mis-verifying); and — most importantly — **no test in
this repository ever broadcasts a real, funded transaction**. Every signature in
`packages/chain-adapters`/`apps/api` tests is real ECDSA over a fresh, never-funded keypair;
every quote/transaction test hits the real, keyless KyberSwap Aggregator API (see
`docs/TRADING.md#provider` — KyberSwap replaced 0x/LI.FI as the sole EVM provider, needs no
API key), and the e2e suite's fixture token addresses are synthetic (never deployed), so the
real API legitimately has no route for them — this codebase turns that into an honest `422`
rather than treating it as a crash.
