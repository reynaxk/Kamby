# Kamby technical reference

The one-page map of how kambesh.com is built and run. Current as of **2026-10-03**. For
incident procedures (pausing trading, rollbacks, database restore) see
[LAUNCH_RUNBOOK.md](LAUNCH_RUNBOOK.md). This file names configuration keys but never holds
secrets; keys live in Railway and Cloudflare.

---

## 1. Tech stack

| Layer | What we use | Notes |
|---|---|---|
| **Website** | Next.js 14 (React), Tailwind, on **Cloudflare Workers** via OpenNext (`kamby-web`, **Workers Paid** plan) | `apps/web`. Deploy: `cd apps/web && pnpm.cmd cf:deploy` (manual) |
| **API** | NestJS (Node 20) on **Railway** (`api` service) | `apps/api`. Auto-deploys on push to `main` |
| **Workers** | Node background jobs on Railway: `workers` (Base + Solana jobs), `workers-bnb` (BNB Chain) | `apps/workers`. Market ingestion, pool discovery, trade/fee sweeps, PnL, balance monitors |
| **Database** | PostgreSQL 16 + TimescaleDB on Railway, volume `postgres-volume-hvol` (~18 GB) | Prisma ORM (`packages/db`). `max_connections=100`. Daily backups on Railway |
| **Cache / pub-sub** | Redis 8 on Railway | Response caches, rate-limit state, gas top-up limits, live market stream fan-out |
| **Auth & wallets** | **Privy** (app `cmuo88ht1001q0cl8wfnazlly`, **production mode**) | Email + Google sign-in only. Embedded wallets (EVM + Solana) auto-created at sign-in. Allowed origins: kambesh.com, www.kambesh.com |
| **Card on-ramp** | Privy funding (Stripe / MoonPay) | "Buy with Apple Pay, Google Pay or card" in Deposit |
| **EVM swap routing** | **KyberSwap** aggregator (primary), OpenOcean | Base and BNB Chain |
| **Solana swap routing** | **Jupiter** Swap API (`api.jup.ag`, paid 10 req/s plan) | All Solana buys and sells |
| **Paid RPC** | **QuickNode** (Base, BNB) for trading only; **Helius** (Solana) | Each has a second fallback endpoint configured |
| **Free RPC** | Public endpoints (`packages/chain-adapters/src/public-rpcs.ts`) | All market data: prices, swap history, pool discovery |
| **Market data** | Own on-chain ingestion (Base/BNB), GeckoTerminal (Solana charts, coin info), DexScreener (Live prices, coin links), PumpPortal (Pump.fun feeds), Coinbase public feed (Crypto tab) | All free tiers, cached server-side |
| **Monitoring** | Sentry (EU, API errors), GitHub Actions uptime check every ~10 min, Railway logs | `scripts/uptime-check.mjs`, `.github/workflows/uptime.yml` |
| **Email** | Cloudflare Email Routing: `support@kambesh.com` → owner's Gmail | Contact on Terms / Privacy / Risk pages |
| **CI** | GitHub Actions (`ci.yml`): typecheck, lint, tests, e2e | Repo `reynaxk/Kamby` (public) |

---

## 2. Architecture and data flow

```
 Browser ──HTTPS──► Cloudflare Worker (Next.js SSR)
    │                    │  server-side fetches, with SSR token (x-kamby-ssr)
    │                    ▼
    ├──HTTPS / SSE──► NestJS API (Railway) ──► Postgres + Redis
    │                    │
    │                    ├──► KyberSwap / OpenOcean (EVM quotes)
    │                    ├──► Jupiter (Solana quotes)
    │                    ├──► QuickNode (EVM trading reads/sends) · Helius (Solana)
    │                    └──► GeckoTerminal / DexScreener (charts, links, live prices)
    │
    ├──► Privy (sign-in, embedded wallets, card on-ramp)
    └──► Public RPCs / Helius browser key (wallet balances)

 Workers (Railway) ──► Public RPCs (Base/BNB pools) · PumpPortal · Coinbase feed
                    └──► Postgres + Redis  (prices, swaps, candles, feeds)
```

### A user visits kambesh.com
1. Cloudflare serves the page. The Worker renders it server-side, calling the API with the
   SSR token so the API doesn't rate-limit the site's own rendering.
2. The home page renders the coin lists on the server. The default coin's chart, activity and
   traders get a **1.2 s budget**; anything slower loads in the browser afterwards.
3. The browser opens one **live stream** (SSE, `/v1/market/feeds/stream`) for the five tabs
   (Trending, Trenches, Bonding, Graduated, Crypto) and the ticker. No polling.

### A user signs in
1. Privy handles email/Google sign-in and creates an **EVM wallet and a Solana wallet**
   automatically. Kamby has a 10 s backup that creates them if Privy didn't.
2. Kamby verifies wallet ownership automatically (a signature, no extra step) and opens an
   API session.
3. The header shows a **USDC balance** (Base + BNB + Solana, read in the browser via public
   RPCs and the Helius browser key) and the profile menu.

### Prices and charts
- **Base / BNB:** workers read pool state and swap logs from **public RPCs** every tick
  (60 s; up to 2,000 blocks per pool per tick), store swaps and 5-minute candles, and
  compute price, liquidity, 24 h volume and market cap.
- **Solana:** curated markets (BONK, WIF, JUP…) refreshed as price snapshots by the `workers`
  Solana market ingestion every 60 s; charts from GeckoTerminal OHLCV
  (cached, last good copy kept 24 h); Pump.fun coins from PumpPortal's websocket.
- **Live timeframe:** the API batches every watched coin into one DexScreener call per chain
  every 2 s; the browser polls `/v1/market/live-price` every 2 s while visible.
- **New coins:** pool discovery takes GeckoTerminal trending/new pools with **≥ $10K**
  liquidity (≥20 buyers / ≥10 sellers in 24 h) and verifies them on-chain.

### A user buys or sells (EVM: Base, BNB Chain)
1. The user enters an amount in **USDC**. The API (`QuoteService`) checks the market is
   tradable, picks the fee tier, and asks **KyberSwap** for a route **USDC → coin** (or coin →
   USDC). It returns unsigned transactions.
2. **Gas:** if the wallet holds ≥ 1 USDC but almost no ETH/BNB, the API's gas top-up sends it
   a few cents of native gas from the gas tank before returning the quote.
3. The user's wallet signs: the one-time **USDC approval** (first trade only), the **swap**,
   then the **fee transfer** (section 3). Kamby never holds a user's keys.
4. The API records the trade; workers' sweeps confirm it on-chain (via QuickNode) and update
   history, positions and realized PnL.

### A user buys or sells (Solana)
1. The user enters an amount in **USDC**. The API asks **Jupiter** for a route and builds one
   transaction with Kamby's fee inside it.
2. **Gasless:** Kamby's Solana relayer co-signs as fee payer, so the user needs no SOL.
3. The user signs once; the API broadcasts through Helius (or Jito, if a priority tip is
   chosen); workers confirm it.

---

## 3. Fees and treasury

### Fee tiers (same on every chain, `packages/domain/src/trading.ts`)

| Trade size (USD) | Fee |
|---|---|
| under $100 | **2.00%** |
| $100 – $499.99 | **1.00%** |
| $500 and up | **0.75%** |

If a trade's size can't be confirmed before the fee is set, the highest tier (2%) applies.

### How the fee is captured

**EVM (Base, BNB Chain): separate USDC transfer.** Every EVM trade is in USDC, so every
EVM fee is in USDC.
- **Buy:** the fee is taken off the USDC the user pays *before* the swap (e.g. $10 → $0.20 fee
  + $9.80 swapped). The quote includes a second transaction: a USDC transfer of the fee
  from the user's wallet to the treasury.
- **Sell:** the swap returns the full USDC to the user; the fee is the tier % of that gross
  USDC, collected by the same separate USDC transfer.
- The app asks for the fee signature right after the swap. Workers track each fee transfer
  (`feeStatus`). **Known limitation:** because it's a second signature, a user who
  deliberately refuses it keeps the fee. Normal app use collects it automatically.
- **Treasury (EVM, both chains):** `0xa3C08B3b8aBc6810FCd12F29f0E644Ab70b3FE80`
  (`PLATFORM_FEE_RECIPIENT_ADDRESS`).

**Solana: inside the swap.** Jupiter's platform fee (`platformFeeBps` + `feeAccount`)
deducts the fee **atomically inside the same transaction**, so there's no way to skip it.
- **Treasury (Solana):** USDC token account `67gPbS2mAaSaLzXB3BUR3aiPCDQxTuM31rLgjdrUdqVP`,
  owned by wallet `CwBR4qXdJ2SHXhJyEWeQzVtAMZeDV8973jB7AMvAX6Ew` (`SOLANA_TREASURY_USDC_ATA`).

### Who pays network fees

| Chain | Mechanism | Wallet (public address) | Limits |
|---|---|---|---|
| Base | Gas top-up: 0.00003 ETH sent to USDC-holding wallets with < 0.00001 ETH | `0x843628cBA13EEFe301286749c1a115a6692CCA5e` | 1 per wallet / 24 h; 60 per day; low-balance warning < 0.0005 ETH |
| BNB Chain | Gas top-up: 0.00015 BNB to wallets with < 0.00005 BNB | same address | 1 per wallet / 24 h; 60 per day; warning < 0.002 BNB |
| Solana | Relayer co-signs every trade as fee payer | `6jS4uCBUEAodYxMXBXSzur1TDjoe33xrdhWELCEmgxWD` | Max 0.003 SOL per transaction; balance logged every 5 min |

Gas is paid back by the platform fee: one Base top-up (~$0.08) is less than the fee on a single
$5 trade ($0.10). The keys for these wallets are only in Railway (`EVM_GAS_TOPUP_PRIVATE_KEY`,
`SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY`); the owner also has them imported in Phantom.

---

## 4. Launch configuration

### Rate limits (API, per visitor IP)
The API identifies visitors by their real IP (`x-real-ip` from Railway's edge, which can't be
spoofed). The website's own server rendering is exempt via the SSR token.

| Endpoint group | Limit |
|---|---|
| Default (everything else) | 120 / min |
| Trade quotes (EVM, Solana) | 20 / min |
| Search | 30 / min |
| Live market stream (connect) | 30 / min |
| Coin info, Solana charts | 60 / min |
| Live price | 90 / min |
| Sign-in / session | 5–20 / min |

**Outbound:** Jupiter calls are spaced to **10 req/s** (`SOLANA_JUPITER_MAX_RPS`); a call that
would queue > 8 s returns "busy, try again". GeckoTerminal and DexScreener responses are
cached (coin info 24 h, charts 30 s–5 min, live prices shared every 2 s).

### RPC setup

| Use | Provider | Why |
|---|---|---|
| Base/BNB trading (quotes, top-ups, confirmations) | QuickNode + fallback | Reliability where money moves |
| Base/BNB market data (pools, swaps, discovery) | Free public RPCs (publicnode, base.org, 48.club…) | Keeps paid credits for trading |
| Solana API + relayer | Helius + fallback | |
| Browser balances | Public RPCs (EVM), separate Helius browser key (Solana) | |

Paid-RPC usage is logged every 10 minutes: `railway.cmd logs --service api --filter "RPC usage"`.
QuickNode usage alerts are set at 50% and 80% of monthly credits.

### Capacity
- **Measured (2026-10-03):** 800 page loads at 60 concurrent → **0 errors**, ~35 page
  renders/s; home page ~0.7 s typical at 25 concurrent.
- **Database:** api pool 15 connections, each worker 5, server max 100.
- **Cloudflare Workers Paid:** 10M requests/month included, 30 s CPU per request.
- **Privy free plan:** 50K signatures and $1M volume per month; auto-upgrades the month after.
- **Jupiter:** 10 req/s ≈ 150+ Solana trades per minute.
- **Gas tanks (current):** ~60 Base and ~45 BNB new-user top-ups, ~50 first-time Solana coin
  buys. Top up before launch.

### Security in place
- Security headers on site and API (CSP, HSTS, X-Frame-Options, nosniff); API CORS allows only
  kambesh.com.
- Secrets redacted from logs (auth, cookies, SSR token, private keys).
- Non-custodial: users' keys stay with Privy; Kamby builds unsigned transactions only.
- Emergency switch: `TRADING_PAUSED` (see runbook §1).
