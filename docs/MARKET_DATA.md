# Market data — Phase 1

How Kamby knows what a token is worth, how liquid it is, and why it's ranked where it is.
Read this before touching `packages/db/prisma/schema.prisma`'s market tables,
`apps/workers/src/market/`, or `apps/api/src/market/`.

## Architecture

```text
Blockchain (Base mainnet, BNB Chain — one per apps/workers deployment)
    ↓
packages/chain-adapters (UniswapV3PoolReader — the only place with pool-specific RPC logic)
    ↓
apps/workers/src/market/ingestion.ts (seed → price/liquidity snapshot → swap backfill → candles)
    ↓
packages/db (chains, tokens, token_markets, swaps, candles, ingestion_cursors)
    ↓
apps/api/src/market (read-only REST — never writes)
    ↓
apps/web (Discover, /market/[address] — never touches the chain or the database directly)
```

Same shape as `docs/SOURCE_OF_TRUTH.md`'s general flow, filled in for Phase 1's actual
tables.

## Supported chains

Two: Base mainnet (`eip155:8453`) and BNB Chain (`eip155:56`, added 2026-09-16) — each
`apps/workers` deployment runs exactly one chain (`CHAIN_IDENTIFIER` env var selects it),
never both from the same process. `CHAIN_RPC_URL` defaults to that chain's own free public
RPC (`mainnet.base.org` / `bsc-dataseed.binance.org`) for local dev; production points at a
dedicated provider (see "Rate limiting" below for why that matters).

## Token discovery: a curated seed list, not a scan (with an opt-in automated path — see below)

`apps/workers/src/market/seed-markets.ts` lists real, verified markets per chain — 12 on
Base, 7 on BNB as of 2026-09-24, not a placeholder set. Each pool address was read directly
on-chain (`token0`/`token1`/`slot0`, confirmed initialized) against that chain's own public
RPC before being added, and cross-checked for genuine liquidity via DexScreener's public API.
**DexScreener was used only to discover which pools have real liquidity worth tracking —
never as a source for the price, liquidity, or token metadata Kamby actually publishes.**
All of that is read directly from the contracts by the ingestion worker; the seed file
itself stores nothing but addresses, deliberately, so there's no stale "fact" about a
token sitting in source control. Entries are only added once they clear a real liquidity
floor (~$100K, checked live at research time) and are on a genuine Uniswap-V3-ABI pool —
Aerodrome/Solidly-style pools on Base use a different reserves model and were explicitly
ruled out for this reason despite real ecosystem prominence (AERO).

Why curated rather than scanning every pool a factory has ever created: Phase 1's stated
scope was "a bounded set of useful markets," and indexing arbitrary new pools safely means
solving spam/rug filtering, which was real work Phase 1 deferred. **This is no longer fully
deferred** — `apps/workers/src/market/pool-discovery.ts` (`PoolDiscoveryService`, added
2026-09-25) is a real, working automated-discovery path, off by default
(`POOL_DISCOVERY_ENABLED`) and not currently enabled on any deployment. See "Automated pool
discovery" below for what it does and its own documented limits. Expanding the *seed* list
manually is still the same as always: add entries to `seed-markets.ts`, not new logic.

Seed-list order matters: a market quoted in another tracked token (e.g. TOSHI/WETH,
CLANKER/WETH) needs its quote token's USD price resolved before it can price itself. Each
chain's own USDC-quoted market must appear earlier in the list than any WETH/WBNB-quoted
market — see the comment in `seed-markets.ts`. (This ordering constraint only binds the
static seed list; `refreshPricesAndLiquidity` itself became order-independent 2026-09-25 —
see "Indexing / ingestion" below.)

## Automated pool discovery (opt-in, off by default)

`PoolDiscoveryService` (`apps/workers/src/market/pool-discovery.ts`) watches this
deployment's chain's real Uniswap-V3-ABI factory contract for `PoolCreated` events instead
of requiring a human to hand-pick every token — the closer-to-"real terminal" answer to the
curated seed list above. Two phases, both Redis-backed (not Postgres — deliberately avoids
needing a schema migration for this first version):

1. **Discovery**: bounded `eth_getLogs` chunking against the factory (same
   `MAX_BLOCKS_PER_TICK` = 150-block discipline as swap ingestion — see "Indexing" below), for
   every `PoolCreated` event whose pool has at least one side already price-resolvable (this
   chain's USDC, or a token already tracked in some existing `TokenMarket`). A pool where
   neither side is resolvable is skipped permanently, not tracked forever unpriceable.
2. **Promotion**: a bounded number of pending candidates get a *real* on-chain liquidity
   check every tick (never trusted from the discovery event alone — a brand-new pool almost
   always starts near-zero and only gains real liquidity over hours/days). A candidate that
   clears `POOL_DISCOVERY_LIQUIDITY_FLOOR_USD` (default $100K, matching the manually-curated
   list's own bar) is promoted into a real `TokenMarket` row via the same `createTrackedMarket`
   path `seedOneMarket` uses — from that point on it's indistinguishable from a seeded market.
   A candidate that never clears the floor within ~14 days is dropped.

**What this explicitly does not do**: any spam/rug detection beyond the liquidity floor — no
honeypot simulation, no mint-authority/ownership checks. A pool can clear real liquidity and
still be a scam. There is also no manual review queue: a candidate that clears the floor
publishes to Markets immediately. Both were real, deliberate product decisions (confirmed
with the user 2026-09-25), not oversights — see that commit's own message for the full
reasoning if either needs revisiting.

Requires `POOL_DISCOVERY_FACTORY_ADDRESS` (a real, independently-verified factory address —
**never assume it matches another chain's**; Base's Uniswap V3 Factory,
`0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, is a different address than Ethereum
mainnet's) and `POOL_DISCOVERY_DEX` once enabled; both fail loudly at boot if unset.

## Price methodology

Read `slot0().sqrtPriceX96` from the pool directly and derive price with
`priceFromSqrtPriceX96()` (`packages/chain-adapters/src/uniswap-v3-math.ts`) — pure,
unit-tested math, no RPC inside it. **Never borrowed from a third party.** Verified during
development against the real Base WETH/USDC pool
(`0x6c561B446416E1A00E8E93E221854d6eA4171372`): our own computation and DexScreener's
independently-reported price agreed to within ~0.005%. See
`uniswap-v3-math.test.ts` — the test fixtures are the real numbers from that check, not
synthetic ones.

USD resolution: USDC (`0x8335...02913` on Base) is treated as pegged 1:1 to USD — a Phase
1 simplification, not a depeg-aware oracle (see "Deferred"). Every other tracked token's
USD price is derived by walking the seed list in order: WETH prices off its USDC pool,
then DEGEN and BRETT price off their WETH pools using WETH's just-computed USD price. If a
quote token's price isn't resolved yet (seed-list ordering violated, or its own pool read
failed), the dependent market's refresh is skipped for that tick and its price is left as
whatever it was — never replaced with a guess.

**If a reliable price can't be established, the field is `null`.** Nothing in this
pipeline invents a plausible-looking number.

## Liquidity methodology

`computePoolLiquidityUsd()`: the pool contract's own token balances
(`balanceOf(poolAddress)` on each side), each converted to USD via the price resolution
above, summed. This is **total value currently held by the pool contract**, not a
concentrated-liquidity-aware TVL-in-range figure — Uniswap V3 liquidity is concentrated
around the current tick, and this number doesn't attempt to model that nuance. It's an
honest, simple, verifiable figure (also cross-checked against DexScreener's reported
liquidity for the same real pool, same ~0.005% agreement), not a precision instrument.

Null, not a fabricated total, when either side's price is unresolved.

## Market cap

`computeFullyDilutedMarketCapUsd()`: on-chain `totalSupply()` × price. This is **FDV
(fully diluted valuation), not circulating market cap** — Kamby has no way to know which
tokens are locked, burned, or held by a treasury versus genuinely circulating. Labeled
"FDV" in the UI (token detail page) for exactly this reason, rather than "Market cap" —
if a genuine circulating-market-cap figure ever becomes product-relevant, it needs a real
circulating-supply source, not a relabeled FDV number.

## Volume and 24h price change

Computed from `swaps` — the authoritative, indexed history of real Swap events — never
estimated or borrowed. A market's `volume24hUsd` and `priceChange24hPct` on `TokenMarket`
are a **cache**, refreshed every ingestion tick from `candles` (itself rebuilt from
`swaps`); the raw swap rows are the source of truth, and both derived fields could be
dropped and recomputed from them at any time.

**`priceChange24hPct` is `null`, not `0%`, until the market has at least 24h of genuinely
indexed history** — a market seeded five minutes ago has no honest 24h-ago price to
compare against, and Phase 1 doesn't pretend otherwise (see `recomputeRollups`
in `ingestion.ts`, `haveFullDay`). The very first tick after seeding a market backfills the
last ~24h of real swap history (see "Indexing" below) specifically so this stops being
true quickly, not to fake it in the meantime.

**Known limitation — quote-token volume conversion:** a swap's USD volume is computed as
`|amount| × price-in-quote × quote's-current-USD-price`, using the quote token's price
*at ingestion time*, not at the historical time of that swap. For USDC-quoted markets
(WETH, cbBTC) this is always exact, since USDC is pegged. For WETH-quoted markets (DEGEN,
BRETT), a swap from an hour ago is valued at *this tick's* WETH/USD price, not the price
WETH actually had an hour ago. Disclosed here rather than silently wrong; the fix is
point-in-time quote pricing per swap, deferred (see below) since it requires indexing the
quote token's own price history at the same granularity, not just its current value.

## Indexing / ingestion

`apps/workers/src/market/ingestion.ts`, run on a timer (`MARKET_INGESTION_INTERVAL_SECONDS`,
default 60s):

```text
seed()                      — idempotent upsert of chain/tokens/markets/cursors
refreshPricesAndLiquidity() — current snapshot for every DB-tracked market on this chain
ingestSwaps()                — incremental, cursor-based, chunked Swap-event backfill
```

`refreshPricesAndLiquidity()` queries every `TokenMarket` row for this chain from the DB
(not just the static seed list) and resolves quote-token price dependencies via repeated
passes (bounded, `MAX_RESOLUTION_PASSES` = 5) rather than relying on the seed list's own
manually-curated array order — changed 2026-09-25 specifically so a market added outside the
seed list (e.g. by `PoolDiscoveryService` promoting a candidate — see above) still gets
ongoing price refresh, not a one-time price at creation that goes stale within the 30-minute
staleness window and silently vanishes from ranked results.

Cursor-based and restartable: `ingestion_cursors` persists `last_processed_block` per
market. A tick advances the cursor in bounded chunks (`LOG_CHUNK_BLOCKS` = 150 blocks per
`eth_getLogs` call, deliberately equal to `MAX_BLOCKS_PER_TICK` so a market's chunking loop
always resolves in exactly one `eth_getLogs` call per tick — real incident behind this
value: an earlier RPC plan capped `eth_getLogs` at a 5-block range, silently multiplying one
intended call into up to 30 and burning ~6M credits in 5 days; re-verified 2026-09-24 that
the current public Base RPC's own real cap is 2,000 blocks, so 150 stays comfortable
headroom under that, not a value to casually raise). The cursor only advances *after* that
chunk's `eth_getLogs` call
succeeds *and* its swaps are persisted — `getSwapEvents` returns `null` (never a bare `[]`)
on an RPC failure specifically so a failed query can't be mistaken for "genuinely no swaps
in this range" and silently skip it forever; ingestion stops for that market this tick and
retries the same range next tick instead. Every swap insert is idempotent
(`@@unique([chainId, txHash, logIndex])`, `skipDuplicates: true`) — a crash mid-chunk means
the next tick re-fetches and re-inserts the same range harmlessly, never duplicates or
corrupts state. A brand-new market's cursor starts at `latest block − ~24h of blocks`, so
its first tick backfills real recent history instead of starting from nothing.

Candles are upserted (not appended) for the touched time range on every tick with new
swaps, directly from `swaps` via a `time_bucket`-grouped `INSERT ... ON CONFLICT DO UPDATE`
— see `upsertCandlesFromSwaps`. Re-running it for the same range always produces the same
rows. `recomputeRollups` (the 24h `volume24hUsd`/`priceChange24hPct` refresh) runs on
*every* tick regardless, including one with zero new swaps — the 24h window is time-based,
not swap-based, so old candles must age out of `volume24hUsd` even on a quiet tick rather
than leaving a stale figure in place. It's `0`, not `null`, once the market has ever had a
swap indexed but nothing falls in the current window; `null` is reserved for a market that
has never had a swap indexed at all — see the `volume24hUsd` comment in `schema.prisma`.

**Rate limiting:** the free public Base RPC (`mainnet.base.org`) throttles concurrent
requests — confirmed directly in production, not just during development: a diagnostic
script run from inside the Railway container got an explicit `"over rate limit"` response
from a burst of 4 simultaneous `readContract` calls for one pool, while the same calls
issued one at a time succeeded. Two mitigations are in place, both real but bounded:

- Every multi-field RPC read (`getPoolState`'s 4 calls, `getTokenMetadata`'s 3) is now
  awaited sequentially, never via `Promise.all`/`allSettled`'s simultaneous kickoff — see
  the doc comments on both methods in `packages/chain-adapters`. Between markets, `seed()`
  and `refreshPricesAndLiquidity()` still pace themselves with `RPC_CALL_DELAY_MS`.
- `seed()` skips a market entirely — no RPC calls, no `RPC_CALL_DELAY_MS` pause — once
  its `tokenMarket` row, both tokens' `decimals`/`symbol`, and its `ingestionCursor` are
  already resolved (see `isFullySeeded` in `ingestion.ts`). A Uniswap V3 pool's fee tier
  never changes, so there's nothing left to re-read; re-fetching four markets' full state
  every 60s forever, even the ones long since fully resolved, was pure waste competing
  with the markets still genuinely unresolved for the same rate-limited budget.

Both measurably helped in production (seeded-market count roughly doubled), but neither
fully eliminates the underlying limit — some seed markets still fail most ticks with
"pool state unreadable." The real fix is a dedicated RPC endpoint (e.g. QuickNode) in
place of the free public one; until then, expect some tracked markets to take a long time
to fully resolve, or to flap between resolved and unresolved.

## Candle granularity and timeframes

Raw candles are 5-minute buckets, stored as a Timescale hypertable (`candles`, partitioned
on `bucket_start`). The `/market/tokens/:address/history` endpoint aggregates those into
the requested chart timeframe *at query time* via `time_bucket()` — 1H stays at 5m, 4H at
15m, 1D at 1h, 1W at 4h, 1M at 1d (see `TIMEFRAME_CONFIG` in `market.service.ts`) — rather
than pre-materializing every timeframe as its own table. Simpler to get right at Phase 1's
data volume; Timescale continuous aggregates are the documented upgrade path once raw-candle
volume makes query-time aggregation slow.

`swaps` is a plain indexed table, not (yet) a hypertable — its idempotency key
`(chain_id, tx_hash, log_index)` doesn't include `block_timestamp`, and TimescaleDB
requires the partitioning column be part of every unique constraint on a hypertable.
Fine at Phase 1's bounded market count; revisit when swap volume actually justifies it.

## Ranking (`/market/discover`)

```text
Discovery Score = 0.4 × log10(1 + volume24hUsd)
                + 0.3 × clamp(priceChange24hPct, −50, +50)
                + 0.3 × log10(1 + liquidityUsd)
```

Implemented once, in `packages/domain/src/market.ts` (`computeDiscoveryScore`,
`DISCOVERY_RANKING`), imported by both the API and (indirectly, by reading this doc) by
anyone trying to understand a ranking — not reimplemented or restated as a separate
"explanation" that could drift from the real formula.

- **Log-scaled volume/liquidity**: raw USD values span many orders of magnitude; without
  log-scaling, one large market would mathematically swamp the other two factors.
- **Clamped momentum** (±50 points): a tiny-liquidity market's percentage change can be
  enormous on a near-zero denominator (a $50 pool moving to $500 is "+900%" and means
  nothing) — clamping caps how much that single factor can move the score.
- **Liquidity gate** (`minLiquidityUsd` = $10,000): a market below this is excluded from
  ranked results entirely, not scored low. Protects against the exact "tiny illiquid token
  with an extreme percentage move" case Phase 1 was asked to guard against.
- **Staleness**: `isStale` (in `MarketSummary`) is `true` once `lastPriceUpdateAt` is
  older than 30 minutes (`isPriceStale` in `packages/domain`) — surfaced in the UI, not
  silently hidden. A `lastPriceUpdateAt` in the future (clock skew, bad data) is also
  treated as stale, defensively, rather than read as the freshest price on record.

Sort modes (`?sort=score|volume|liquidity|priceChange`) all apply the same liquidity gate;
they only change which factor orders the (already-gated) result set. See
`market.service.ts#discover` for why ranking is computed in application code rather than
SQL at Phase 1's market count, and the documented path off that once it stops being small.

## Search

Server-backed substring match (case-insensitive) on symbol, name, or an exact
(case-insensitive) contract-address match — `market.service.ts#search`. No client-side
loading of the token table; the web app's `SearchBar` is a plain GET form, not a
typeahead calling a client-exposed endpoint (see `docs/SOURCE_OF_TRUTH.md` — the browser
never talks to anything but the Next.js server, which talks to the API server-side).

## API endpoints

| Route | Notes |
| --- | --- |
| `GET /v1/market/discover` | `?sort=score\|volume\|liquidity\|priceChange&limit=1-100&search=` |
| `GET /v1/market/tokens/:address` | 404 if untracked, 400 if not address-shaped |
| `GET /v1/market/tokens/:address/history` | `?timeframe=1H\|4H\|1D\|1W\|1M`, empty array (not an error) when there's no history yet |
| `GET /v1/market/search` | `?q=&limit=1-50`, `q` required and non-empty |

## Real-time updates

Polling via `router.refresh()` on a client-side interval (`AutoRefresh`, 20–30s) against
Next.js's own revalidating server fetch — not a WebSocket. Deliberate: Phase 1's "don't
overengineer real-time" guidance, and the ingestion tick itself only runs every 60s, so a
push channel would have nothing new to say between ticks anyway. The seam is ready for a
future upgrade (the API already returns `lastPriceUpdateAt` for exactly this purpose) once
sub-minute ingestion makes push worth the complexity.

## Known limitations (Phase 1, as shipped)

- Two chains (Base, BNB), one DEX protocol per chain family (Uniswap-V3-ABI pools only —
  Aerodrome/Solidly-style pools use a different reserves model and aren't read; this ruled
  out AERO as a Base seed-list candidate despite real ecosystem prominence).
- USDC is treated as exactly $1; no depeg detection.
- Non-USD-quoted markets' historical swap volume uses today's quote price, not the
  price at trade time (see "Volume and 24h price change" above).
- `marketCapUsd` is FDV, not circulating supply.
- Pool liquidity is total value held, not concentrated-liquidity-aware.
- No token risk/safety signals beyond a liquidity floor (honeypot detection, mint
  authority, etc.) — the curated seed list was manually vetted for real liquidity during
  research; `PoolDiscoveryService`'s automated path (see above) checks liquidity only, not
  a full safety screen, and is off by default regardless.
- A market's price/liquidity only updates once per ingestion tick (default 60s) — the UI
  can be up to that far behind the chain.

## Deferred to later phases

Non-Uniswap-V3-ABI DEX support (Aerodrome/Solidly-style pools), automated pool discovery's
spam/rug/honeypot filtering beyond a liquidity floor, a manual review queue for
automatically-discovered pools before they publish, token risk scoring, point-in-time quote
pricing for swap volume, a circulating-supply source for true market cap, Timescale
continuous aggregates, converting `swaps` to a hypertable, and genuine push-based real-time
updates.
