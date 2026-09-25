# Deployment

Managed, usage-priced infrastructure, no Kubernetes, no self-managed nodes.

| Piece | Actual platform | Deploy trigger |
| --- | --- | --- |
| `apps/web` | Cloudflare Workers | **Manual**, from a local machine — `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (see "Web (Cloudflare Workers)" below). No CI step builds this. |
| `apps/api` | Railway (service `api`) | **Automatic** — GitHub-connected, redeploys on every push to `main`. |
| `apps/workers` | Railway, one service per EVM chain (`workers` = Base, `workers-bnb` = BNB Chain) | **Automatic**, same as `apps/api` — both services rebuild on every push to `main`, since `apps/workers` is one chain per deployed instance (see `docs/MARKET_DATA.md#supported-chains`) but both track the same repo/branch. |
| Postgres | Railway managed Postgres (with the Timescale extension) | N/A — a database, not a deploy target. |
| Redis | Railway managed Redis | N/A |

**A push to `main` does NOT run a database migration.** This bit the project once already
(2026-09-24/25: a real production outage — `/v1/market/discover` and `/v1/market/search`
500ing — from pushing API code that expected a new table before the migration that creates
it had actually been applied). Railway's auto-deploy only builds and restarts the process;
`prisma migrate deploy` is a separate, manual step every time the schema changes — see
"Running a migration" below. If you're about to push a schema change, run the migration
*first*, or push it as its own commit before the code that depends on it.

## Web (Cloudflare Workers)

From the repo root:

```bash
cd apps/web
rm -rf .next .open-next
pnpm cf:deploy
```

`pnpm cf:deploy` runs `opennextjs-cloudflare build && opennextjs-cloudflare deploy` (see
`apps/web/wrangler.jsonc` for the Worker config) — this is a real build-and-upload from
whichever machine runs it, not a Cloudflare-hosted CI build. There is currently no
GitHub-Actions-style automatic trigger for this app; a code change to `apps/web` isn't live
until someone runs this command.

### Web build config (`NEXT_PUBLIC_*` vars)

Next.js inlines every `NEXT_PUBLIC_*` var into the client JS bundle at **build** time, so
whichever machine runs the build needs them present as real env vars, not just documented
somewhere.

Two files supply them, both read automatically by Next.js:

- **`apps/web/.env.production`** (git-tracked, real values, safe to commit) — the shared
  floor every teammate's build resolves to. `NEXT_PUBLIC_PRIVY_APP_ID` is a public client
  identifier by design; `NEXT_PUBLIC_CHAIN_RPC_URL` is the free, keyless public Base RPC.
  `NEXT_PUBLIC_SOLANA_RPC_URL` is different — the fully public
  `api.mainnet-beta.solana.com` was tried first (2026-09-14) and turned out too unreliable
  for Privy's own browser-side transaction simulation (real trades failed with "error
  preparing your transaction"), so it's a **separate, dedicated Helius key**, scoped to
  browser traffic only — never the same key apps/api's own `SOLANA_RPC_URL` uses. Committing
  this specific key is a deliberate call: it's real and rate-limited like any API key, but
  its blast radius is capped to browser-facing reads, never the backend's trading-critical
  quota, which is the property that actually matters here (see `lib/solana-config.ts`'s own
  doc comment on the trust-boundary reasoning). apps/api's own paid QuickNode/Helius URLs
  briefly lived in this file before 2026-09-14 — a real, live key exposure (anyone can read
  a `NEXT_PUBLIC_*` value straight out of the shipped bundle) — never repeat that mistake
  here regardless of which fix is in place.
- **`apps/web/.env.local`** (gitignored, machine-specific) — takes precedence over
  `.env.production` per Next's own env-file precedence, for local overrides during
  development. Not a substitute for `.env.production` being correct and complete; that
  file is the one a fresh machine can build a correct production bundle from with zero
  other setup.

Server-only `API_BASE_URL` is different: it's supplied as a Cloudflare Worker binding via
`wrangler.jsonc`'s own `vars` block (also git-tracked), not via either `.env` file, since it
never needs to be baked into the client bundle.

## API and workers (Railway)

Five real services in one Railway project: `api`, `workers`, `workers-bnb`, plus managed
`postgres` and `Redis`. `api`/`workers`/`workers-bnb` are each connected to this repo's
GitHub `main` branch (`railway service source connect --repo <owner>/<repo> --branch main
--service <name>`, done once per service) and rebuild automatically on every push — check
`railway status` (from a directory linked to this project — `railway link`) to see each
service's current deploy state, or `railway logs --service <name>` to tail its output.

Real config difference between `workers` and `workers-bnb`: same Docker image, different
environment variables (`CHAIN_IDENTIFIER`/`CHAIN_RPC_URL`/etc.) — `apps/workers` is
architected as one chain per deployed instance (see `apps/workers/.env.example`'s own doc
comment), so a third EVM chain going live means a *third* Railway service, not a config
change to an existing one.

### Setting/reading variables

```bash
railway variable set SOME_KEY=some-value --service api
railway variable list --service api --kv   # prints raw values — treat the output as a secret
```

Reading or setting a real variable's value should generally be done by a human directly at
a keyboard, not delegated — printing a live credential into any log/transcript is exactly
the kind of exposure `apps/web/.env.production`'s own history (see above) already shows the
real cost of getting wrong once.

### One-off commands against a live service (e.g. a migration)

`railway run --service <name> -- <command>` executes `<command>` **locally**, with that
service's real environment variables injected — but Railway's managed Postgres/Redis are
only reachable from *inside* Railway's own private network (`postgres.railway.internal`),
not from an arbitrary local machine, so this only works for commands that don't need to
reach the database directly over that internal hostname. For anything that does — most
importantly, running a migration — see "Running a migration" below.

### Running a migration

```bash
railway run --service api pnpm --filter @kamby/db migrate:deploy
```

This is the one `railway run` invocation that *does* reach the internal database, because
`prisma migrate deploy` itself makes the actual connection using the `DATABASE_URL` Railway
injects into the command's environment — the command runs locally, but the TCP connection
it opens goes out from wherever this is actually executed. Run this from a real terminal,
by a human — not delegated to an AI session running in an isolated sandbox that may not be
able to reach `postgres.railway.internal` at all (a real, confirmed limitation, not a
hypothetical one: this exact command failed with `P1001: Can't reach database server` when
attempted from inside a sandboxed AI coding session, 2026-09-24).

**Always run this before or immediately alongside pushing code that depends on a new
migration** — never after, and never assume Railway's auto-deploy does this for you. It
does not.

## Database and Redis

Both are Railway's own managed offerings (`postgres` and `Redis` in the project) — no
separate account, no separate vendor relationship. Postgres has the Timescale extension
enabled (see `docs/MARKET_DATA.md#candle-granularity-and-timeframes` for what actually uses
it). `DATABASE_URL`/`REDIS_URL` are set automatically by Railway for any service in the same
project that references them — not hand-copied between services.

## What this document does NOT do

It does not provision any of the above from scratch — creating the Railway project itself,
connecting GitHub, and the very first `railway variable set` for each service's real secrets
are manual, one-time setup steps outside this repository, done by whoever has the actual
Railway account access. This document describes the deploy *mechanics* of the infrastructure
as it exists today, not a from-scratch infrastructure-provisioning runbook.
