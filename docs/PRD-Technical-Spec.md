# Kamby — Multichain Execution Architecture

**PRD & Technical Specification**
Status: Draft v1 · Target: EVM (live) + Solana (net-new) · Owner: Kamby core team

---

## 0. Current State vs. Target State

This spec extends a platform that already has a working EVM trading engine — it does not start from zero. Read this before the roadmap, because "add Solana" and "swap the RPC provider" are very different sizes of change.

**Already built (apps/api, apps/web, packages/chain-adapters):**
- Single EVM chain live today: **Base** (`chainId 8453`), RPC configured via `CHAIN_RPC_URL` (currently the public `mainnet.base.org` endpoint — a placeholder, not rate-limit-safe for production volume).
- Quote → sign → verify flow: the API builds a quote via the LI.FI aggregator (Uniswap V3 and others) — previously 0x, then briefly 1inch, settled on LI.FI: no forced fee skim on top of Kamby's own platform fee, deep liquidity, and a documented (not silently-limited) free tier — see `docs/TRADING.md#provider` for the tradeoff this involved (a portal-registered fee wallet, not a per-request address); the connected wallet (wagmi/viem) signs and broadcasts; the backend never holds keys or signs, and confirms the trade only by matching the mined transaction's sender/destination/value/calldata against the original quote (`transactionMatchesQuote` — see `docs/TRADING.md#transaction-integrity`).
- Market data ingestion, trader intelligence, notifications, watchlists, and the sweep worker are all EVM-only today; they read chain state through the same `ChainDataProvider` abstraction (`packages/chain-adapters`), which already takes its RPC URL as injected config rather than hardcoding a provider — swapping providers is a config change, not a code change.
- Web app is mid-migration to Cloudflare Workers (OpenNext adapter) for edge hosting.

**Net-new for this spec:**
- Solana as a second, parallel chain — no existing Solana adapter, wallet integration, quote logic, or indexing exists yet. This is a full build, not a port.
- QuickNode as the shared RPC provider across both EVM and Solana reads (replacing the Base placeholder URL).
- The Jito/Helius direct-submission write path — entirely new, and only makes sense for Solana (EVM/Base has no equivalent bundle-relay layer at this stage; its write path stays wallet-broadcasts + backend-verifies, unchanged).
- WebSocket/streaming state for portfolio and order updates, replacing polling, on both chains.

Decision on record: **multichain (EVM + Solana), QuickNode as primary RPC for both.**

---

## 1. System Overview & Objectives

Kamby is a social crypto discovery and trading platform. The objective of this spec is to make execution feel instantaneous without taking custody of funds or requiring a backend that sits in the critical path of every trade.

### Performance targets
| Target | Value | Notes |
|---|---|---|
| Edge UI response (TTFB) | < 50ms | Served from Cloudflare's edge network, not origin-roundtrip |
| Perceived trade confirmation | Instant | Optimistic UI updates the position/order state immediately on submit, before chain confirmation |
| Solana bundle inclusion | < 400ms (next-block target) | Bounded by Solana's own block cadence (~400ms); Jito bundle priority tipping is what makes hitting that realistic under load |
| Base (EVM) inclusion | Bounded by L2 block time (~2s) | Not a latency figure we control — flagged here so "sub-second" isn't misread as a platform-wide guarantee across every chain |
| Sustained write throughput | 50+ tx/s without RPC throttling | Achieved by moving writes off the RPC path entirely (Section 4), not by paying for a bigger RPC tier |

### Budget target
~$50/mo initial burn:
- QuickNode Build plan: $49/mo (80M credits, 50 RPS cap) — shared across EVM + Solana reads
- Helius: free tier to start (Sender endpoint fallback is low-volume by design — see Section 4)
- Jito Block Engine: no platform fee; cost is the dynamic priority tip paid per bundle, borne by the trader, not the platform
- Cloudflare Workers: free tier covers early volume; Workers Paid ($5/mo) is the first upgrade if traffic outgrows it

This budget only holds if the 3-pillar blueprint below is actually implemented — without edge caching and WebSocket streaming, read traffic alone will blow through QuickNode's 50 RPS cap well before any meaningful trading volume.

### The 3-Pillar Latency & Cost Blueprint
1. **Edge caching (Cloudflare Workers)** — token metadata, prices, and other slow-changing reads are cached at the edge, so repeated reads don't re-hit QuickNode.
2. **Streaming state (WebSockets)** — replaces `getAccountInfo`/balance polling with persistent subscriptions (`accountSubscribe` on Solana; log/event subscriptions on EVM) for portfolio and order updates.
3. **Bypassing RPC for writes** — transactions are constructed and signed client-side and submitted directly to Jito relayers (Solana) rather than through the QuickNode RPC pipeline, so write volume never counts against the RPC's rate limit at all.

---

## 2. Tech Stack & Provider Matrix

| Layer | Provider / Tech | Chain(s) | Role |
|---|---|---|---|
| Frontend hosting | Cloudflare Workers (via OpenNext adapter) | — | Edge-served Next.js app, sub-50ms TTFB, no cold starts |
| Edge caching | Cloudflare Workers KV / Cache API | EVM + Solana | Caches token metadata, prices, static account state |
| Primary RPC (reads) | QuickNode, Build plan | EVM (Base, extensible) + Solana | `getAccountInfo`, `getTransaction`, contract reads, historical queries |
| State streaming | WebSockets (`accountSubscribe` on Solana; equivalent log/event subscriptions on EVM) | EVM + Solana | Real-time portfolio, position, and order updates without polling |
| Write execution (Solana) | Jito Block Engine (primary) + Helius Sender (fallback) | Solana only | Client-signed transactions submitted directly as priority bundles, bypassing RPC |
| Write execution (EVM) | Wallet-broadcast (wagmi/viem) + `transactionMatchesQuote` backend verification | EVM (Base) | Unchanged from the current live flow — non-custodial, backend never signs |
| Non-custodial verification | Kamby API (`apps/api`) | EVM + Solana | Confirms the executed trade matches the quote it issued; never holds keys or funds on either chain |

---

## 3. System Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Client Browser (Wallet: EVM via wagmi/viem, Solana via wallet-adapter)"]
        UI[Optimistic UI]
        Signer[Local Transaction Signing]
    end

    subgraph Edge["Cloudflare Edge (Workers + KV/Cache)"]
        CacheLayer[Edge Cache: token metadata, prices, account snapshots]
        WSGateway[WebSocket Gateway]
    end

    subgraph Reads["Read Path — QuickNode RPC (Build plan)"]
        QN_EVM[QuickNode: EVM/Base RPC]
        QN_SOL[QuickNode: Solana RPC]
    end

    subgraph WritesSol["Write Path — Solana Only"]
        Jito[Jito Block Engine — priority bundle submission]
        Helius[Helius Sender — fallback relay]
    end

    subgraph WritesEvm["Write Path — EVM Only"]
        WalletBroadcast[Wallet broadcasts signed tx via its own provider]
    end

    subgraph Backend["Kamby API (apps/api) — non-custodial"]
        Quote[Quote construction: LI.FI (EVM), Jupiter-class aggregator (Solana)]
        Verify[Post-trade verification: transactionMatchesQuote]
    end

    UI -->|request quote| Backend
    Backend -->|reads pool/account state| QN_EVM
    Backend -->|reads pool/account state| QN_SOL
    Quote -->|quote returned| UI
    UI --> Signer
    Signer -->|EVM: signed tx| WalletBroadcast --> QN_EVM
    Signer -->|Solana: signed tx, RPC bypassed| Jito
    Jito -.fallback on reject/timeout.-> Helius
    QN_EVM -->|confirmation| Verify
    Jito -->|bundle landed| Verify
    Helius -->|landed| Verify
    Verify -->|state update| WSGateway
    WSGateway -->|accountSubscribe / push| UI
    CacheLayer -->|served for repeat reads| UI
    UI -.cache miss.-> Backend
```

Key property preserved from the existing architecture: **the backend is never in the signing or custody path on either chain.** On Solana it isn't even in the write-submission path — it only confirms after the fact, same role `transactionMatchesQuote` already plays for EVM today.

---

## 4. RPC & Transaction Routing Logic

### 4.1 Reads (both chains)
1. Client requests data (price, token metadata, position state).
2. Check Cloudflare edge cache first. Hit → serve from edge, no RPC call, no backend round-trip.
3. Miss → request goes to the Kamby API, which calls QuickNode (EVM or Solana endpoint, chain-routed).
4. Response is written back to the edge cache with a TTL appropriate to volatility (prices: seconds; token metadata: hours).
5. For anything that changes while the user is looking at it (balances, open positions, order status), the client instead holds a WebSocket subscription — no polling loop, no repeated RPC calls at all.

### 4.2 Writes — Solana
1. Client requests a quote from the Kamby API (aggregator route, expected output, price impact — same shape as the existing EVM quote object).
2. Client constructs the transaction locally and signs it with the connected Solana wallet. **The backend never sees the private key and never signs.**
3. Client attaches a dynamic priority tip (in SOL, sized to current network conditions) and submits the signed transaction as a bundle **directly to the Jito Block Engine** — this call never touches QuickNode.
4. If Jito rejects or times out (bundle not accepted, no leader slot available), the client falls back to submitting via the **Helius Sender** endpoint.
5. Once the backend observes the transaction landed (via a lightweight confirmation subscription — not the write path, just watching for it), it runs the Solana equivalent of `transactionMatchesQuote`: fetch the finalized transaction and confirm its actual instructions (program, accounts, amounts) match what was quoted, before marking the trade confirmed in Kamby's own records.
6. Confirmed state pushes to the client over the WebSocket gateway; UI had already shown it optimistically at step 3.

### 4.3 Writes — EVM (Base) — unchanged
1. Client requests a quote (LI.FI).
2. Wallet signs and broadcasts via its own provider (not routed through Jito/Helius — those are Solana-only).
3. Backend polls/watches for the receipt via QuickNode's EVM endpoint and runs `transactionMatchesQuote`.

This is deliberately left alone. There's no Jito-equivalent bundle-relay layer in scope for Base at this stage, and the existing flow already meets the non-custodial requirement.

### 4.4 Traffic-spike handling
- Read bursts are absorbed by the edge cache (Section 3) before they ever reach QuickNode — this is what keeps the platform under the 50 RPS cap, not a bigger QuickNode plan.
- Write bursts on Solana don't touch QuickNode's RPS cap at all, since they bypass RPC entirely; the limiting factor becomes Jito bundle acceptance and Helius Sender's own rate limits, not Kamby's RPC budget.
- If QuickNode's 50 RPS cap is approached anyway (e.g. a spike in cache-miss reads), the API should degrade by serving slightly-stale cached data with a longer TTL rather than queuing requests against the RPC — staleness is a better failure mode than throttling for read-heavy UI data.

---

## 5. Implementation Roadmap

Sequenced so each step is independently verifiable before the next depends on it.

1. **QuickNode cutover (EVM)** — replace the placeholder `CHAIN_RPC_URL` (`mainnet.base.org`) with a QuickNode Base endpoint in `apps/api/.env`, `apps/workers/.env`, `apps/web/.env`. Verify: existing EVM quote/trade flow and market-data ingestion still pass their current test suites against the new endpoint.
2. **Cloudflare edge deploy (in progress)** — finish the OpenNext Cloudflare Workers deploy already underway for `apps/web`; this is the foundation the edge-caching pillar sits on. Verify: app serves correctly from a Workers URL before attaching the custom domain.
3. **Edge caching layer** — add Cloudflare KV/Cache-API caching in front of the existing token-metadata and price read endpoints. Verify: repeat reads for the same token don't generate repeat QuickNode calls (check QuickNode's request dashboard before/after).
4. **WebSocket state streaming (EVM first)** — replace the current EVM balance/position polling with a subscription-based push model. Verify: UI updates on-chain state changes without a visible polling interval, confirmed against a real Base wallet.
5. **Solana chain adapter (new)** — build the Solana equivalent of `ChainDataProvider` (`packages/chain-adapters`): account reads, token metadata, transaction lookups, over QuickNode's Solana endpoint. Verify: adapter passes the same contract-style test suite pattern already used for the EVM adapter.
6. **Solana wallet integration + quoting** — wallet-adapter connection flow, and a quote-construction service (aggregator route) mirroring the shape of the existing LI.FI quote object. Verify: a quote can be requested and displayed end-to-end with no transaction submitted yet.
7. **Solana write path — Jito primary** — client-side transaction construction, signing, and direct Jito Block Engine bundle submission with dynamic priority tipping. Verify on devnet first: a signed bundle lands without ever touching the QuickNode RPC log.
8. **Solana write path — Helius Sender fallback** — wire the fallback for Jito rejection/timeout cases. Verify by forcing a Jito failure (e.g. malformed bundle in a test harness) and confirming Helius Sender picks it up.
9. **Post-trade verification (Solana)** — implement the Solana analog of `transactionMatchesQuote`: fetch the landed transaction, confirm its actual instructions match the quote before marking it confirmed. Verify: a tampered/mismatched transaction is correctly rejected, same as the existing EVM test coverage does today.
10. **WebSocket state streaming (Solana)** — `accountSubscribe`-based push for Solana positions/orders, same pattern as step 4.
11. **Load verification** — simulate sustained 50+ tx/s write volume and confirm QuickNode's request dashboard shows read traffic only, comfortably under the 50 RPS cap, with writes going entirely through Jito/Helius.
12. **Budget check** — confirm actual QuickNode credit burn, Helius tier, and Cloudflare Workers usage after a real trading day against the ~$50/mo target; adjust cache TTLs or upgrade tiers as needed before this becomes a production bottleneck.
