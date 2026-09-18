# Deployment

> **Stale as of 2026-09-14, except the "Web build config" section below.** This doc
> describes the originally-planned infra (Vercel/Fly.io/Neon/Upstash) — what's actually
> live is Cloudflare Workers (`apps/web`) and Railway (`apps/api`, `apps/workers`, managed
> Postgres, managed Redis). A full rewrite is tracked separately; don't follow the
> Vercel/Fly.io/Neon/Upstash instructions below as current setup steps.

Matches the approved architecture: managed, usage-priced infrastructure, no Kubernetes,
no self-managed nodes at this stage.

| Piece | Target | Why |
| --- | --- | --- |
| `apps/web` | Vercel | Zero-config Next.js hosting with edge caching for public pages. |
| `apps/api` | Fly.io (or Railway) | Container hosting for a long-running Nest process; `apps/api/Dockerfile` builds it. |
| `apps/workers` | Fly.io (or Railway), separate app/machine from the API | Independently deployable and independently scalable from request-serving — see the architecture spec. `apps/workers/Dockerfile` builds it. |
| Postgres | Neon | Managed Postgres with the Timescale extension available; branching is convenient for a small team. |
| Redis | Upstash | Serverless, usage-priced, no server to operate. |

## Web build config (`NEXT_PUBLIC_*` vars) {#web-build-config}

The one section here that's current. `apps/web` deploys to Cloudflare Workers via
`opennextjs-cloudflare build && opennextjs-cloudflare deploy`, run locally (there's no
Cloudflare-hosted build step) — see `apps/web/wrangler.jsonc`. Next.js inlines every
`NEXT_PUBLIC_*` var into the client JS bundle at **build** time, so whichever machine runs
the build needs them present as real env vars, not just documented somewhere.

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

## Web (Vercel)

1. Import the repository into Vercel.
2. Root Directory: `apps/web`. Vercel auto-detects the monorepo via `turbo.json` and only
   needs the app's own build command (`next build`) — no custom install command required
   as long as the project uses pnpm (Vercel detects `pnpm-lock.yaml` automatically).
3. Set `NEXT_PUBLIC_API_BASE_URL` to the deployed API's public URL (see
   `apps/web/.env.example`) — it backs the live activity stream and follow/like mutations,
   the one place the browser talks to the API directly (see `docs/SOCIAL.md#realtime`). It
   defaults to `http://localhost:4000`, which is wrong in production, so this one is not
   optional. `API_BASE_URL` (server-only, used for every other page) can be left at its
   default only if the API is reachable at that address from Vercel's build/runtime.

## API and workers (Fly.io)

Each app deploys as its own Fly app, built from its own Dockerfile with the **repo root**
as build context:

```bash
fly launch --dockerfile apps/api/Dockerfile --name <api-app-name> --no-deploy
fly launch --dockerfile apps/workers/Dockerfile --name <workers-app-name> --no-deploy
```

Set secrets per app (never commit these — see `apps/api/.env.example` and
`apps/workers/.env.example` for the full list each one needs):

```bash
fly secrets set -a <api-app-name> DATABASE_URL=... REDIS_URL=... CORS_ORIGIN=... \
  JWT_SECRET=$(openssl rand -base64 32)
fly secrets set -a <workers-app-name> DATABASE_URL=... REDIS_URL=... CHAIN_RPC_URL=... \
  CHAIN_IDENTIFIER=eip155:8453 CHAIN_NAME=Base CHAIN_NATIVE_SYMBOL=ETH
```

Then:

```bash
fly deploy -a <api-app-name> --dockerfile apps/api/Dockerfile
fly deploy -a <workers-app-name> --dockerfile apps/workers/Dockerfile
```

The API's health check (`GET /health`) is what Fly (or any platform's health check
config) should poll — it verifies both the database and Redis are reachable, not just
that the process is up.

## Database and Redis (Neon / Upstash)

1. Create a Neon Postgres project; enable the `timescaledb` extension (Neon supports it —
   check the current list of supported extensions if this ever changes) or point
   `DATABASE_URL` at any Postgres 16 instance with `timescaledb` installed.
2. Run the migration against it once: `DATABASE_URL=... pnpm --filter @kamby/db migrate:deploy`.
3. Create an Upstash Redis database and use its connection string as `REDIS_URL`.

## What Phase 0 does NOT do

It does not provision any of the above automatically — that requires accounts and
credentials only the project owner has. This document is the runbook; running it against
real accounts is a manual step outside this repository.
