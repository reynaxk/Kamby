# Wallet security principles

## Non-custodial, by construction

This backend is never in a position to move a user's funds — not because it's trained not
to, but because it structurally cannot:

- **No private keys are ever stored anywhere** — not in the database, not in a queue
  payload, not in a log line, not in an environment variable.
- **No seed phrases are ever collected, transmitted, or stored.**
- **The server never signs a transaction on a user's behalf.** Signing happens exclusively
  in the user's own wallet (browser extension, mobile wallet, or WalletConnect session).
  `apps/api`'s `TradingModule` (built in Phase 3 — see `docs/TRADING.md`) builds unsigned
  transactions and hands them to the client; it never holds a signing key. The client
  (`apps/web/components/trading/TradePanel.tsx`) hands that unsigned transaction to wagmi's
  `sendTransaction`/`writeContract`, which delegate to whatever wallet is connected — Kamby's
  own code is never in the signing path.

If a future change ever appears to require server-side signing or key storage, that is a
signal the design is wrong, not a signal to add a secrets vault for keys. Stop and
reconsider the flow instead.

## Wallet-first identity

A wallet is not a user. The data model (`packages/db/prisma/schema.prisma`'s future
`wallets` table, landing in Phase 2) must support:

```text
Wallet
  ↓
may belong to a User (once someone signs up and links it)

or

Wallet
  ↓
tracked publicly, with no registered User at all
```

Most wallets this platform will ever have data about — including every whale surfaced in
discovery — will never sign up. Modeling the wallet as the primary entity, with the user
link optional, is what makes trader-intelligence features possible without waiting on
registration. See `docs/SOURCE_OF_TRUTH.md` and the architecture spec for the full
`wallets` shape; Phase 0 only needs this principle to not be foreclosed by today's schema,
which it isn't — `chains`/`tokens`/`token_markets` don't reference a `users` table at all.

## Login, as actually built

Phase 2 shipped one way in — `POST /identity/session` mints an anonymous session with no
wallet-ownership claim at all (see `docs/SOCIAL.md#authentication`). Phase 3 added the
second, exactly as this section originally planned:

- **Sign-In With Ethereum (EIP-4361)** — proves wallet ownership via a signed message, not
  a password. Still never touches a private key server-side; the signature is produced by
  the wallet, the server only verifies it (`packages/chain-adapters/src/signature.ts`,
  wrapping viem's `verifyMessage`). See `docs/TRADING.md#wallet-ownership` for the full
  challenge/verify flow.

**Email/passkey via a managed auth provider remains unbuilt and unscheduled.** Nothing in
Phase 3 needed it — trading only ever required proving control of a wallet, which SIWE
already does — so it stays a documented option rather than a committed one.

## What Phase 0 already enforces

- `helmet()` is applied globally in `apps/api/src/main.ts` for secure HTTP defaults.
- CORS is explicit and configured from `CORS_ORIGIN`, not wildcarded.
- A global rate limiter (`@nestjs/throttler`) is wired in from the start — see
  `apps/api/src/app.module.ts` — so every future endpoint is rate-limited by default
  rather than needing someone to remember to add it.
- The global exception filter (`apps/api/src/common/filters/all-exceptions.filter.ts`)
  never echoes an unrecognized error's message or stack to the client in production.
- Structured logs (`nestjs-pino` in the API, `pino` in the worker) redact
  `authorization`/`cookie`/`password`/`secret`/`token`/`privateKey`/`seedPhrase` paths by
  default — see the `redact` config in both `app.module.ts` and
  `apps/workers/src/lib/logger.ts`.
- Every required environment variable is validated at boot (`zod`, via
  `packages/domain`'s `parseEnv`) — a missing secret fails loudly at startup, not silently
  at the point of use.

## Solana: non-custodial launch, one deliberate, named exception

Solana trading (added 2026-09-12/13, live at `/solana`) follows the exact same principle as
the EVM flow above, with the same non-negotiable line: the server never signs a transaction
that moves a user's funds. `apps/api/src/solana/` builds unsigned transactions (via
`JupiterQuoteService`) and hands them to the client; `apps/web/components/trading/
SolanaTradePanel.tsx` signs *and broadcasts* them itself, through the user's own Privy
embedded wallet (`useSignAndSendTransaction`) — Kamby's backend is never in the signing path
for the swap itself. A real trade confirmed this way, live, on 2026-09-13 (signature
`32cxp7j5rxS2RemJ49f4f1o46ESiDqwGpgNtT97nk279PfuWBtve2PczgUQJqYeRT2hPwXeUty55Z3nAf3G5ipNf`).

**The one named exception, designed but deliberately not deployed**: `GasRelayerService`
(`apps/api/src/solana/gas-relayer.service.ts`) sponsors network fees so users never need to
hold SOL — see `docs/GAS_RELAYER_PLAN.md` for the full design. This key never signs
anything that moves a user's tokens or USDC; it only ever occupies the transaction's
*fee-payer* slot, on a transaction the user's own wallet has already signed in its own
signer slot first (`GasRelayerService` refuses to ever be the first or only signer — see
`assertUserAlreadySigned`). Its blast radius is capped by its own small, manually-funded
balance and a hard per-transaction lamports ceiling checked before every broadcast, and its
instruction surface is allowlisted exhaustively (`gas-relayer-instruction-guard.ts`),
rejecting anything outside a small set of known-safe programs and, specifically and by name,
any `CloseAccount` instruction — the named mitigation for ATA rent-draining, a real attack
Privy's own documentation warns sponsors of this exact pattern about.

This is the "stop and reconsider the flow" moment the rule above describes — and the
resolution here is that this one narrow, heavily-guarded case (paying a network fee, never
touching token custody, always co-signing second) is judged an acceptable, deliberately
scoped exception to the general rule, not a reason to abandon it generally. The code exists
(written and tested 2026-09-13) but is **not wired into any module, route, or the app's
required environment schema** — see that file's own doc comment for exactly what "not wired
up" means concretely. Wiring it up is real, scoped, post-launch work, not a same-session
add-on to a live, working, non-custodial swap flow.
