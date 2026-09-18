# Phase 5: trader intelligence & personalized discovery

Phases 0–4 built market data, social identity, non-custodial trading, and realtime
notifications. Phase 5 turns that indexed data into a trustworthy trader-intelligence and
personalized-discovery layer — no new indexing, no new tables, entirely derived from
`swaps`, `follows`, `activity_likes`, and `trade_transactions` the platform already owns.

**The hard rule governing every metric below: never fabricate a financial performance
number.** If a statistic can't be derived correctly from data Kamby actually has, it's
either left unimplemented or, where it since has been (see
[Realized PnL](#realized-pnl)), scoped precisely to what the data actually supports rather
than approximated.

```text
swaps / follows / activity_likes / trade_transactions   (Postgres, already authoritative)
    ↓
Pure formulas (packages/domain/src/trader-intelligence.ts — no I/O, fully unit-tested)
    ↓
Bounded SQL aggregation (apps/api — GROUP BY / raw aggregates, never a per-row loop)
    ↓
Redis cache-aside for public rankings only (explicit TTL; Postgres remains authoritative)
    ↓
API (apps/api/src/social, apps/api/src/market, apps/api/src/discovery)
    ↓
Kamby Web (apps/web)
```

## Trader statistics

Computed by `TraderService#getProfile` (`apps/api/src/social/services/trader.service.ts`)
from indexed `swaps` where `trader_address` matches, and served as
`TraderProfile.stats` — see `TraderStatsSchema` in `packages/domain/src/wallet.ts`. Every
field is either a direct SQL aggregate or a pure formula in
`packages/domain/src/trader-intelligence.ts` over that aggregate; nothing is a per-swap
loop in application code.

| Field | Definition | Null when |
|---|---|---|
| `totalSwaps` | `COUNT(*)` for this trader | never (0 is real) |
| `buyCount` / `sellCount` | `COUNT(*)` filtered by `side` | never |
| `volumeUsd` | `SUM(volume_usd)`, all-time | never (0 is real) |
| `uniqueTokensTraded` | distinct `token_market_id` count | never |
| `avgTradeSizeUsd` | `volumeUsd / totalSwaps` | `totalSwaps = 0` |
| `largestTradeUsd` | `MAX(volume_usd)`, all-time | `totalSwaps = 0` |
| `volume24hUsd` / `tradeCount24h` | same aggregates, `block_timestamp >= now() - 24h` | never (0 is real once the wallet has ever traded) |
| `buyRatio` | `buyCount / totalSwaps`, in [0, 1] | `totalSwaps = 0` |
| `concentrationIndex` | see below | `totalSwaps = 0` |
| `activityFrequencyPerDay` | `totalSwaps / max(1, daysSinceFirstSeen)` | `totalSwaps = 0` |

**Concentration index.** `computeConcentrationIndex` in `trader-intelligence.ts` implements
a Herfindahl-Hirschman-style index: `sum((tokenVolume / totalVolume)^2)` across every token
the wallet has traded. This is a standard, well-known concentration formula (used broadly
in economics for market concentration), not an invented metric. It ranges from close to 0
(volume spread evenly across many tokens) to 1 (all volume in a single token).

Every field above is nullable exactly where "no data yet" is genuinely true, and never a
fabricated `0` standing in for "unknown" — the same null-vs-zero discipline
`docs/SOURCE_OF_TRUTH.md` establishes for market data.

## Trader activity history

`GET /social/traders/:address/activity` (Phase 2, unchanged in Phase 5) already serves a
cursor-paginated history of confirmed, indexed trades — token, buy/sell direction, USD
amount, timestamp, and transaction hash — reusing the exact same `Swap` → `SocialActivity`
projection the global feed uses. Reviewed against Phase 5's requirements and found already
complete; no changes were needed.

## Trader → token

`GET /social/traders/:address/tokens` (`TraderService#getTraderTokens`) — the tokens a
wallet has traded, aggregated: token identity, trade count, volume, and last activity
timestamp. One `GROUP BY token_market_id` bounded by `limit` (ordered by volume, this
trader's most significant tokens first), then one batched `TokenMarket` lookup for the
returned ids — never a query per token.

## Token → trader

`GET /market/tokens/:address/traders` (`MarketService#getTokenTraders`) returns:

- `uniqueTraders24h` — read directly off `TokenMarket.uniqueTraders24h` (Phase 2's own
  cached column), never recomputed here.
- `recentTraders` — the most recently active *distinct* traders on this token, one query
  (`DISTINCT ON` via Prisma's `distinct` + `orderBy`).
- `activeTraders` — traders with the most trades on this token in the last 24h, one
  `GROUP BY` bounded to that window.
- `recentLargeTrades` — this token's own recent trades at/above
  `LARGE_TRADE_USD_THRESHOLD` (see below), reusing the same `SocialActivity` shape/mapper
  as every other activity listing.

Three bounded queries total, never a loop over traders.

## Trader discovery

Three complementary, transparently-labeled rankings — never unqualified "best trader":

- **Top Traders** (`GET /social/traders/top`, Phase 2, unchanged) — ranked by real 24h
  `SUM(volume_usd)`. Activity, not profitability.
- **Active Traders** (`GET /discovery/active-traders`, new) — ranked by real 24h
  `COUNT(*)` instead. Also activity, not profitability.
- **Leaderboard** (`GET /social/leaderboard`, see [Realized PnL](#realized-pnl)) — the one
  ranking that *is* profitability, ranked by real, matched realized PnL over a rolling
  window. Kept as a separate endpoint/ranking rather than folded into Top/Active Traders:
  those two are wallet-scoped (any tracked wallet, no Kamby account required) and
  all-chain-activity-derived; the leaderboard is User-scoped (a real Kamby account, since
  PnL accrues per-account across a user's linked wallets) and Kamby-trade-derived only —
  mixing the two would blur what each ranking actually measures.

Top Traders and Active Traders share the same `MIN_TRADES_FOR_TRADER_RANKING` floor (2
trades) so a single huge or one-off trade can't win either ranking — this constant used to
be a private copy inside `trader.service.ts`; Phase 5 centralized it into
`@kamby/domain` so both rankings can never quietly disagree on the floor.

## Large trades

`GET /discovery/large-trades` — recent confirmed swaps at/above `LARGE_TRADE_USD_THRESHOLD`
across every tracked market, newest first. This threshold is `NOTIFICATION_DEFAULTS.
whaleTradeUsdThreshold` from Phase 4 (`packages/domain/src/notifications.ts`), re-exported
as `LARGE_TRADE_USD_THRESHOLD` — the exact same number Phase 4's whale-trade notifications
use, so "large trade" never means two different things in two different parts of the
product.

## Rising

"A measurable increase in activity, never a vibe." Two independent signals, both reusing
data this codebase already computes rather than a new momentum formula:

- **Rising tokens** — a token counts as Rising when it entered trending (Phase 4's
  `TokenTrendingState.becameTrendingAt`) within `RISING_TOKEN_WINDOW_HOURS` (24h). This
  reuses Phase 4's own trending-transition tracking directly; Phase 5 adds no second
  trending algorithm.
- **Rising traders** — a wallet counts as Rising when *both*: (a) its 24h trade count
  clears `RISING_TRADER_CONFIG.minTradeCount24h` (3 — never call a trivial trade count
  "rising"), and (b) that 24h count is at least `RISING_TRADER_CONFIG.multiplier` (2×) the
  wallet's own all-time daily average (`activityFrequencyPerDay`). This is a genuine,
  computable comparison against the wallet's *own* history, not an arbitrary absolute
  count.

**Performance.** Rising traders is the one ranking that could tempt a "for every trader,
check if they're rising" loop — the exact anti-pattern the spec calls out. Instead:
one bounded raw aggregate finds candidates clearing the 24h floor (`LIMIT 100`), one further
bounded `GROUP BY` fetches just those candidates' all-time totals, and `isRisingTrader` runs
in memory over that small, already-fetched array. Two queries total, regardless of how many
wallets have ever traded.

`GET /discovery/rising` returns `{ tokens, traders }` together as one section, matching how
the product frames "Rising" as a single discovery idea.

## Personalization

### Personalized discovery (`GET /discovery/personalized`)

A weighted, deterministic score over a *bounded candidate pool* — exactly the same
discovery-score-gated set of tracked markets `/market/discover` already ranks (Phase 1's own
documented "small, bounded tracked-market count" assumption — see `MarketService#discover`).
Every signal query below is scoped `WHERE token_market_id IN (candidateIds)`; nothing here
queries per-candidate.

```text
score = 0.30 · marketActivityScore        (the token's own computeDiscoveryScore — reused, never recomputed)
      + 0.30 · followedTrader             (a followed trader traded this token in the last 24h)
      + 0.20 · tradingInterest            (the viewer has personally traded this token before)
      + 0.10 · log10(1 + viewerLikeCount) (the viewer liked activity involving this token)
      + 0.10 · max(0, 1 - hoursSince / 72) (recency of the most relevant signal, decaying to 0 over 72h)
```

See `PERSONALIZATION_WEIGHTS` / `computePersonalizationScore` in
`packages/domain/src/trader-intelligence.ts` — every weight and window is a named,
documented constant, not a magic number, and the whole function is pure and unit-tested in
isolation (boundary tests for zero followers, zero likes, exactly-at-the-recency-edge, and
determinism).

Each returned item carries `reasons: string[]` — plain sentences built by
`buildPersonalizationReasons`, one per signal that actually fired ("Alex traded this
recently", "You've traded this before"), falling back to "Active on the market" when no
personal signal applies. Never an unexplained label like "AI picked" or "smart money" — see
the spec's own explicit prohibition on those.

### Personalized feed (`GET /discovery/feed`)

Deliberately **not** a scored re-ranking of activity — reordering a chronological,
cursor-paginated feed by score breaks pagination in subtle ways (an item already sent to a
client could later "belong" on an earlier page). Instead: the personalized feed is a
**union** — followed-trader activity `OR` the same quality-gated general feed
`/social/activity` already uses — ordered by `block_timestamp DESC` exactly like every other
activity feed in this codebase. One `WHERE` clause, one `ORDER BY`, so cursor pagination
works identically to `ActivityService#getGlobalFeed`.

This guarantees the anti-filter-bubble requirement structurally, not by convention: general
market discovery is *always* present in the union, never crowded out. Each item is tagged
`reasonCode: 'FOLLOWED_TRADER' | 'GENERAL_DISCOVERY'` with a matching `reason` string (see
`feedReasonText`), so the client can show "Because you follow Alex" vs "Active on the
market."

Implementation split: `ActivityService#getPersonalizedFeedCandidates`
(`apps/api/src/social/services/activity.service.ts`) owns the query itself — it's 100%
existing activity-pagination machinery, extended in place, with no knowledge of Phase 5
concepts. `DiscoveryService#personalizedFeed` wraps that with the reason tagging, which is
where "why is this here" actually lives.

## Security

- Every personalized endpoint (`/discovery/personalized`, `/discovery/feed`) requires a
  session (`JwtAuthGuard`) and resolves `userId` exclusively from that session — never from
  a query param, body field, or any other client-supplied value. There is no way to request
  another user's personalized view.
- Public rankings (`/discovery/active-traders`, `/discovery/large-trades`,
  `/discovery/rising`, and the extended `/social/traders/:address`,
  `/social/traders/:address/tokens`, `/market/tokens/:address/traders`) expose only data
  already public elsewhere in the product (trade history, follower counts, wallet display
  identity) — nothing about session internals, nonces, or authentication state.
- Rate limiting on every new endpoint — see the table below. Production throttle values are
  never weakened to make a test pass.

| Endpoint | Limit |
|---|---|
| `GET /discovery/active-traders` | 30/min |
| `GET /discovery/large-trades` | 30/min |
| `GET /discovery/rising` | 30/min |
| `GET /discovery/personalized` | 20/min (authenticated) |
| `GET /discovery/feed` | 20/min (authenticated) |
| `GET /social/traders/:address/tokens` | inherits the module default |
| `GET /market/tokens/:address/traders` | inherits the module default |
| `GET /social/leaderboard` | 30/min |
| `PATCH /identity/profile` | 20/min (authenticated) |
| `POST /identity/profile/avatar` | 5/min (authenticated) — real I/O (an R2 upload), not a bounded DB query |

## Performance & caching

Every ranking is bounded: a fixed time window (24h), a `LIMIT`, and either a single SQL
aggregate or at most two bounded queries chained together (candidate-then-detail, never
candidate-then-N-detail-queries). Nothing in Phase 5 scans the full historical `swaps`
table on a live request.

**Redis caching** (`DiscoveryService#cached`, cache-aside) applies only to the *public*
rankings — active traders, large trades, rising tokens, rising traders — each with an
explicit `DISCOVERY_CACHE_TTL_SECONDS` (30s) TTL. A cache miss or a Redis failure (read or
write) computes fresh from Postgres and degrades gracefully — Redis is never the source of
truth, and an outage never turns into a 500. Personalized endpoints are **not** cached
(they're inherently per-user, and cheap enough not to need to be at Phase 1's current
tracked-market scale — the same assumption `MarketService#discover` already documents).

## Realized PnL

Phase 5 deliberately left PnL, ROI, and win rate unimplemented. Computing them from
`swaps` (all indexed pool activity, no ownership/inventory model, no linkage between an
entry and the exit that closes it) would have meant guessing at cost basis or silently
ignoring off-platform activity — exactly what this doc's hard rule prohibits. This section
is the fix that reasoning predicted: a real, correct realized-PnL figure, scoped precisely
to what Kamby's own data actually supports — see
[What this still deliberately does not do](#what-this-still-deliberately-does-not-do) for
what stays out of scope even now.

### Scope: Kamby-originated trades only

Realized PnL is computed **only** from `trade_transactions` / `solana_trade_transactions`
(Phase 3's own record of trades placed *through* Kamby, `status = CONFIRMED`) — never
`swaps` (indexed pool activity generally, with no per-wallet ownership model). A wallet's
activity outside Kamby is invisible to this metric, and that's stated in the product UI,
not hidden. This sidesteps the "full wallet inventory" trap the deferred-metrics reasoning
above flagged: Kamby doesn't need to know everything a wallet has ever held, only what it
bought and sold *through Kamby*, which is a small, exact, complete ledger.

### Methodology: FIFO lot-matching, realized only

- **Realized, not unrealized/mark-to-market.** Only PnL from a completed BUY→SELL pair
  counts. An open position (bought, not yet sold through Kamby) contributes nothing until
  it's sold — no live-price guess on unsold inventory.
- **FIFO.** Each CONFIRMED BUY creates a `TokenLot` (`packages/db/prisma/schema.prisma`) —
  raw quantity, cost basis in USD, acquisition time. Each CONFIRMED SELL consumes open lots
  oldest-first via `matchFifoSell`/`computeFifoRealizedPnl`
  (`packages/domain/src/pnl.ts`, pure functions, fully unit-tested) — partial-lot
  consumption and multi-lot sells both handled; a lot's `quantityRemainingRaw` is
  decremented, never `quantityOriginalRaw` (an already-partially-sold lot is never
  double-spent).
- **A sell exceeding known open lots is excluded from PnL, not fabricated as profit.** A
  wallet that held the token before ever trading it through Kamby, or acquired more via a
  transfer, produces an `unmatchedQuantityRaw` that `PnlLedgerSweepService`
  (`apps/workers/src/pnl/pnl-ledger-sweep.ts`) simply never turns into a `RealizedPnlEvent`
  — the same "skip rather than guess" discipline as every other metric in this doc.
- **Token identity keys off `Token.id`, not `TokenMarket.id`.** The same fungible token can
  trade through multiple pools; keying lots by market would silently fragment one real
  position across non-matching pools.
- **Gross, not fee-adjusted.** Gas and any platform fee are not subtracted — a disclosed
  simplification, not an oversight, in the same category as the pricing approximation
  below.

### Pricing: quote-time, not settlement-time

There is no ERC-20/SPL Transfer-log decoding anywhere in this codebase — adding one was out
of scope here, so every dollar figure is priced off each trade's own **quote**, not a
decoded on-chain settlement amount:

- **EVM** — `TradeQuote.priceUsd` is always the *base token's own* USD price
  (`TokenMarket.priceUsd` at quote time), regardless of trade side. Cost basis for a BUY
  = `expectedOutputAmount` (base token, decimal-formatted) × `quote.priceUsd`; proceeds for
  a SELL = `inputAmount` (base token) × `quote.priceUsd`. A null `quote.priceUsd` (a real,
  documented possibility — see `docs/SOURCE_OF_TRUTH.md`) means the row is marked processed
  and skipped, never priced at a guess.
- **Solana** — `SolanaTradeQuote.priceUsd` is never populated anywhere in
  `solana-quote.service.ts`, so EVM's approach doesn't apply. Every Solana trade through
  Kamby is anchored to `SOLANA_USDC_MINT` on one side by construction (a BUY always spends
  USDC, a SELL always produces USDC) — so that leg's raw amount (6 decimals) *is* the USD
  figure directly, no price lookup needed. `PnlLedgerSweepService` defensively verifies this
  invariant per row (`usdcLeg !== SOLANA_USDC_MINT` → mark processed, log, skip) rather than
  assuming it silently.

### Computation: an async, cross-chain sweep

PnL is **not** computed inline with trade confirmation. `apps/workers` runs one replica
*per EVM chain* by design (`CHAIN_IDENTIFIER`), but a PnL sweep spans all of a user's
chains at once — hooking into the four existing CONFIRMED-status call sites
(`TransactionService`/`SolanaTransactionService` in `apps/api`,
`TradeSweepService`/`SolanaSweepService` in `apps/workers`) would duplicate financial logic
across two runtimes and risk two chains' replicas double-processing the same user
concurrently.

Instead: `TradeTransaction`/`SolanaTradeTransaction` each carry a `pnlProcessedAt
DateTime?` marker, and a fully decoupled `PnlLedgerSweepService` scans both tables for
`status = CONFIRMED AND pnlProcessedAt IS NULL`, batched (`BATCH_SIZE`, per-row try/catch —
one bad row never aborts the batch), enabled via `PNL_LEDGER_SWEEP_ENABLED` on exactly
**one** workers deployment, not per-chain. A Postgres advisory lock
(`pg_advisory_xact_lock(hashtext(userId || ':' || tokenKey))`, acquired on the same
transaction client every read/write in that block uses) is the correctness backstop
regardless of how many replicas end up running it.

### Surfaces

- **`GET /social/leaderboard?window=24h|7d|30d`** — one bounded `GROUP BY userId` over
  `realized_pnl_events` (indexed `[userId, confirmedAt]`), then two small batched lookups
  (User identity, most-recently-used verified wallet). Redis cache-aside, 30s TTL, same
  pattern as `DiscoveryService#cached`.
- **`GET /social/traders/:address`** — gained a `realizedPnl: { '24h', '7d', '30d' }`
  block (`TraderService#computeRealizedPnl`), one further aggregate per window scoped to
  that wallet's linked `userId`. `null` (the whole block) for a wallet with no linked
  User — "no Kamby account" is real and common; a real object with `null` window stats
  means "has an account, zero realized PnL so far."
- **Null-vs-zero, once more.** `realizedPnlUsd`/`realizedPnlPct` are `null` — never a
  fabricated `0` — when zero volume was matched in a window at all
  (`toPnlWindowStats` in `packages/domain/src/pnl.ts`), the same discipline
  `TraderStats.avgTradeSizeUsd`/`buyRatio` already establish elsewhere in this doc.

### Identity: username + PFP

Real identity moved from `Wallet` (`displayName`/`avatarUrl` — unused, zero writers,
removed in the same migration) to `User.username`/`User.avatarUrl`: one consistent handle
across a user's several verified wallets/chains, matching how a leaderboard entry is
inherently a `User`, not a `Wallet`. `username` is validated app-side (`isValidUsername` in
`packages/domain/src/wallet.ts`): 3–20 chars, `[a-z0-9_]`, stored lowercase, a small
reserved-word blocklist for anti-impersonation. `PATCH /identity/profile` updates it (409
on collision, never a silent truncation); `POST /identity/profile/avatar` uploads a
PNG/JPEG/WebP (2MB cap; SVG deliberately excluded — a real XSS surface an avatar upload has
no business opening) to Cloudflare R2 via `R2StorageService` and persists the resulting URL
server-side in the same call — a client-supplied arbitrary `avatarUrl` is never accepted,
closing a minor hotlinking/tracking-pixel abuse surface for free.

### What this still deliberately does not do

Before this section existed, Kamby's data model genuinely lacked matched entries/exits,
full wallet inventory, and a Kamby-vs-off-platform distinction — the methodology above is
the fix. What's still deliberately out of scope, even with realized PnL now real:

- **Unrealized/mark-to-market PnL on open positions** — would need a live price for every
  held token; realized-only avoids that entirely.
- **Fee-adjusted PnL** — gross only, see above.
- **A wallet's full on-chain inventory** — still genuinely out of reach without decoding
  Transfer logs; Kamby-originated-only remains the honest scope.

**Also out of scope, per the phase's own boundary:** AI recommendations, copy trading,
automated trading, portfolio management, bridges, leverage/perps, lending, staking, fiat,
subscriptions, DMs, native mobile, custody, and private-key handling.

**Also out of scope, per the phase's own boundary:** AI recommendations, copy trading,
automated trading, portfolio management, multi-chain, bridges, leverage/perps, lending,
staking, fiat, subscriptions, DMs, native mobile, custody, and private-key handling.
