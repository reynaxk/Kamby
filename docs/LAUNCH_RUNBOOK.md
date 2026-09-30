# Launch runbook

What to do when something breaks on or after launch day. Every action below takes about a
minute. Railway commands use `railway.cmd` on Windows (`railway` elsewhere), run from the
repo root.

## 1. Stop new trades — `TRADING_PAUSED`

Use this first if trades are going wrong (bad quotes, wrong amounts, failed swaps, fee
problems). Browsing, charts and the live feed keep working, and trades users already signed
still get recorded and confirmed.

```sh
railway.cmd variables --service api --set TRADING_PAUSED=true    # pause (api restarts, ~1 min)
railway.cmd variables --service api --set TRADING_PAUSED=false   # resume
```

While paused, every new quote (Base, BNB, Solana) answers `503 Trading is paused for
maintenance — please try again shortly. Your funds are safe in your wallet.`

## 2. Roll back the website (Cloudflare)

```sh
cd apps/web
pnpm.cmd exec wrangler deployments list     # newest last; copy the version id you want
pnpm.cmd exec wrangler rollback <version-id>
```

A rollback is instant. The next normal deploy (`rm -rf .next .open-next && pnpm.cmd cf:deploy`)
replaces it. **Order matters:** the API rejects query parameters it doesn't know
(`forbidNonWhitelisted`), so deploy the API before any web change that sends a new parameter,
and never roll the API back past a parameter the live web sends.

## 3. Roll back the API or workers (Railway)

Railway redeploys `api`, `workers` and `workers-bnb` on every push to `main`.

- **Fastest:** Railway dashboard → the service → Deployments → a previous good deployment →
  Redeploy.
- **In git:** `git revert <bad-commit> && git push` (triggers a normal redeploy).

## 4. Turn off one subsystem

Workers-side switches (set on `workers` and/or `workers-bnb`):

| Variable | What it stops |
|---|---|
| `POOL_DISCOVERY_ENABLED` | New Base/BNB coins being added (factory + GeckoTerminal) |
| `PUMPFUN_INGESTION_ENABLED` | Pump.fun launches (Trenches/Bonding) — `workers` only |
| `SOLANA_MARKET_INGESTION_ENABLED` | Curated Solana coin prices |

**To turn one of these off, delete the variable — do not set it to `false`.** These flags are
parsed with `z.coerce.boolean()`, which reads the string `"false"` as *true*.
`TRADING_PAUSED` is the exception: it is parsed strictly, and `false` means off.

## 5. Health checks

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://api-production-a88d.up.railway.app/health
curl -s -o /dev/null -w "%{http_code}\n" https://kambesh.com/
curl -s -N -m 5 https://api-production-a88d.up.railway.app/v1/market/feeds/stream | grep "^event:" | sort | uniq -c
railway.cmd logs --service api        # also: workers, workers-bnb
```

The live stream should print `trending`, `graduated`, `trenches`, `bonding` and several
`crypto` events within 5 seconds.

At startup the API logs `Postgres connections: N client of MAX max`. Client connections
must stay well below `max_connections`. Pools: api `DATABASE_CONNECTION_LIMIT=15`, each
worker 5.

## 6. When an outside service fails

Kamby degrades rather than breaks. Nothing below needs action unless it lasts.

| Service | Used for | If it's down |
|---|---|---|
| Public RPCs (`PUBLIC_EVM_RPC_URLS`) | Base/BNB prices, swaps, discovery | Falls back through 4 endpoints per chain; prices go stale after 30 min if all fail |
| QuickNode / Helius (paid) | Trade confirmation, balances, Solana | Trades can't confirm; pause trading (§1) |
| KyberSwap / OpenOcean | EVM swap routes | "No live quote" errors on EVM |
| Jupiter | Solana swap routes | "No live quote" errors on Solana |
| PumpPortal | Trenches / Bonding | Tabs freeze on their last state; the worker reconnects on its own |
| GeckoTerminal | Solana charts, new-pool candidates | Solana charts empty; no new pools found |
| Coinbase public feed | Crypto tab | Last prices stay; reconnects on its own |
| Privy | Sign-in, wallets, card funding | Nobody can sign in; check status.privy.io |

## 7. Launch day

- **T-24h:** CI green on `main`; web deployed from `main`; all health checks (§5) pass;
  one real $1–2 test trade each on Base, BNB and Solana.
- **T-1h:** `railway.cmd logs` for all three services show no errors; the Privy app is in
  production mode.
- **T+0 to T+2h:** watch `railway.cmd logs --service api` and Sentry (once `SENTRY_DSN` is
  set). If trades misbehave, pause first (§1), investigate second.
