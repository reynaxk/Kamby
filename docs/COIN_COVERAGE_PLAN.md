# Coin coverage: research and plan

Goal: many more coins in Kamby, from every major launchpad, still **tradable**, scams kept
out, margins protected. Research done 2026-10-03 with live API checks (results below are
real responses, not documentation claims).

## Findings

### Trading is not the bottleneck. Kamby's own price reader is.
- **Solana:** Jupiter routes coins from every launchpad, **including Pump.fun coins still on
  their bonding curve** (live quote: USDC → minutes-old pump.fun coin routed
  "Obsidian → Pump.fun", 0.01% impact).
- **Base:** KyberSwap routed **every** non-Uniswap-v3 trending coin tested from USDC: Uniswap
  v4 (Clanker/Zora), Aerodrome, Virtuals (Uniswap v2), Bankr, o1-launchpad (~$4.84–4.99 out
  per $5).
- **BNB:** KyberSwap already quotes BNB in production; PancakeSwap v2 / Infinity routing to
  be confirmed in-app.
- **But Kamby only lists coins whose pool it can read itself (Uniswap-v3-style).** Of today's
  top-20 trending pools, only **5/20 on Base** and **5/20 on BNB** are that kind. Most live on
  Aerodrome, Uniswap v4, PancakeSwap v2 or PancakeSwap Infinity.

### Free data sources that work

| Source | What it gives | Cost / limits | Verified |
|---|---|---|---|
| **Jupiter Tokens API v2** | Solana trending / top traded / top organic (5m, 1h, 6h, 24h), recent launches; per coin: price, mcap, liquidity, holders, 5m–24h stats, **launchpad** (pump.fun, letsbonk.fun, met-dbc, raydium-launchlab, ember, stonkfun…), **organicScore**, **audit** (mint/freeze authority, dev holdings) | Free `lite-api.jup.ag`; we also have a paid key | ✅ |
| **GeckoTerminal** | Trending / new pools on every DEX (Base, BNB, Solana), OHLCV candles | Free ~30 calls/min, shared; already rate-limits us at peaks | ✅ |
| **DexScreener** | Prices, liquidity, volume for up to 30 tokens per call | Free ~300 calls/min | ✅ |
| **Clanker API** | Base Clanker launches with price, mcap, volume; trending | Free, no key | ✅ |
| **GoPlus** | EVM token security: honeypot, buy/sell tax, can't-sell-all, mintable, hidden owner | Free tier, no key | ✅ |
| **PumpPortal** | Pump.fun / Bonk.fun new coins + graduations (free); **trades are paid** (0.01 SOL / 10,000 events) | Mixed | ✅ |

### What's wrong today
- **Bonding tab is misleading:** Kamby gets Pump.fun launches but no trade updates (paid on
  PumpPortal), so "closest to graduating" coins sit at 2–16% instead of 80–99%.
- **Trending was majors-heavy** (fixed 2026-10-03: no stables/wrapped/$500M+).

## Plan

### Phase 1: Solana, every launchpad (biggest win, ~1 day, no new costs)
- New ingestion from **Jupiter Tokens API** every 60 s: toptrending / toptraded / toporganic
  (5m + 1h + 24h) + recent.
- **Safety filter** before listing: organic score not "low", mint and freeze authority
  disabled, liquidity ≥ $10K (graduated) and holders ≥ ~50, dev holding < 20%.
- Coins land in Trending / Graduated with a **launchpad badge**. Tradable through the existing
  Jupiter path and fee. Charts via GeckoTerminal with the existing "last good" cache.
- **Fix Bonding progress:** read Pump.fun bonding-curve accounts on-chain for the top
  candidates in batched Helius calls, not PumpPortal's paid trade feed.

### Phase 2: Base + BNB, every DEX (~2 days)
- **"Aggregator-priced" EVM markets:** price / liquidity / volume / mcap from DexScreener
  (batched), discovery from GeckoTerminal trending + new pools on **all** DEXes, plus the
  Clanker API.
- **Safety filter** via GoPlus: reject honeypots, buy/sell tax > 10%, can't-sell-all, hidden
  owner; liquidity ≥ $10K.
- Trading through KyberSwap as today (USDC in/out, gas top-up).

### Phase 3: pre-graduation feeds (after launch)
- LetsBonk / Meteora DBC bonding coins (Solana), four.meme (BNB), Clanker/Zora brand-new
  (Base) as browse tabs.

## Margins
- **Data: free** with the sources above. Avoid pay-per-event feeds (PumpPortal trades,
  Bitquery). If traffic outgrows GeckoTerminal's free tier, CoinGecko's paid API is the
  upgrade (check current pricing then).
- **Routing:** Jupiter and KyberSwap charge Kamby nothing; Kamby's 2% stays intact.
  Launchpad curve fees (e.g. Pump.fun ~1%) are paid by the trader on top.
- **⚠️ Solana token-account rent:** Kamby's gasless relayer pays ~0.002 SOL (~$0.30) the
  first time a user buys each coin. More memecoins mean more small first buys: a $2 buy earns
  $0.04 and costs $0.30. **Needs a rule before Phase 1 goes live** (minimum first buy, a small
  new-coin charge, or accept it).
- **Gas tanks:** more Base/BNB trading means more top-ups; covered by fees, but watch the
  balances.
