import { parseEnv } from '@kamby/domain';
import { z } from 'zod';

/**
 * Server-only — every market-data fetch happens in Server Components/Route Handlers, so
 * the browser never needs (and is never given) the API's address directly. That's also
 * why this is `API_BASE_URL`, not `NEXT_PUBLIC_API_URL`: nothing here should ever be
 * inlined into the client bundle. See docs/MARKET_DATA.md.
 */
export const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export const env: ServerEnv = parseEnv(ServerEnvSchema, process.env);

/**
 * The one deliberate exception to "the browser never talks to the API directly" — see
 * docs/SOCIAL.md#realtime. A live SSE connection and a follow/like mutation both need a
 * real browser-to-API request, which structurally cannot go through a Server Component.
 * `NEXT_PUBLIC_`-prefixed vars are inlined into the client bundle by Next.js at build
 * time; nothing secret may ever be added to this schema.
 */
export const ClientEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** Phase 3 — see docs/TRADING.md#chain-scope. The one chain the wallet-connect UI will
   *  ever offer to trade on; must name the same chain apps/api's CHAIN_ID does. Public by
   *  nature (every wallet already knows every chain id), so NEXT_PUBLIC_ is correct here
   *  unlike API_BASE_URL above. */
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive().default(8453),
  /** A public RPC endpoint the *browser* reads from directly (e.g. to detect the wallet's
   *  current network) — never the same trust boundary as apps/api's own CHAIN_RPC_URL, and
   *  fine to expose since it's read-only and rate-limited server-side regardless. */
  NEXT_PUBLIC_CHAIN_RPC_URL: z.string().url().default('https://mainnet.base.org'),
  /** Optional: enables WalletConnect (mobile wallets that aren't an in-app browser) in
   *  addition to injected/Coinbase Wallet connectors. Get one at https://cloud.reown.com —
   *  wallet connect is simply omitted, not broken, when this isn't set. */
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: z.string().optional(),
  /** A public RPC endpoint for BNB Chain — added 2026-09-15 alongside
   *  apps/api's own CHAIN_BNB_* config, mirroring the same "omitted, not half-initialized"
   *  pattern: BNB Chain simply doesn't appear in wagmi's `chains` list (see wagmi-config.ts)
   *  until this is actually set, matching the backend's own still-dormant state — trading
   *  isn't enabled on this deployment yet either way (CHAINS doesn't list "bnb"). */
  NEXT_PUBLIC_CHAIN_BNB_RPC_URL: z.string().url().optional(),
  /** A public RPC endpoint for Ethereum mainnet — same "omitted, not half-initialized"
   *  pattern as NEXT_PUBLIC_CHAIN_BNB_RPC_URL above: Ethereum simply doesn't appear in
   *  wagmi's `chains` list until this is actually set, mirroring the backend's own still-
   *  dormant state (apps/api's `CHAINS` env var doesn't list "ethereum" yet either). */
  NEXT_PUBLIC_CHAIN_ETHEREUM_RPC_URL: z.string().url().optional(),

  /**
   * Solana trading — see docs/TRADING.md#solana. All three below are optional and travel
   * together: when any is missing, the Solana trading UI simply doesn't render (see
   * lib/privy-config.ts / lib/solana-config.ts) rather than half-initializing with a
   * missing piece. Mirrors apps/api's `SOLANA_ENABLED` gate — not literally read from the
   * same env var (client and server env are separate trust boundaries), but the same
   * "off means off, cleanly" intent.
   */
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().optional(),
  /** A public, read-only Solana RPC endpoint the *browser* reads from directly (balance
   *  checks, confirmation polling) — never the same trust boundary as apps/api's own
   *  SOLANA_RPC_URL, same reasoning as NEXT_PUBLIC_CHAIN_RPC_URL above. */
  NEXT_PUBLIC_SOLANA_RPC_URL: z.string().url().optional(),
  /** Where a signed transaction actually gets broadcast when the user opts into a Jito
   *  tip — see SolanaTradePanel.tsx's `signAndBroadcastViaJito`. Defaults to the real,
   *  verified mainnet endpoint (confirmed live against Jito's own docs, 2026-09-13) rather
   *  than requiring configuration — unlike the Solana fields above, this doesn't gate
   *  whether Solana trading renders at all; it only matters once a user is already inside
   *  that flow and picks a non-"Off" priority level. Overridable to point at a specific
   *  regional Block Engine cluster (amsterdam/frankfurt/ny/tokyo) if that's ever needed. */
  NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL: z.string().url().default('https://mainnet.block-engine.jito.wtf/api/v1/transactions'),
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;

export const clientEnv: ClientEnv = parseEnv(ClientEnvSchema, {
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
  NEXT_PUBLIC_CHAIN_RPC_URL: process.env.NEXT_PUBLIC_CHAIN_RPC_URL,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  NEXT_PUBLIC_CHAIN_BNB_RPC_URL: process.env.NEXT_PUBLIC_CHAIN_BNB_RPC_URL,
  NEXT_PUBLIC_CHAIN_ETHEREUM_RPC_URL: process.env.NEXT_PUBLIC_CHAIN_ETHEREUM_RPC_URL,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
  NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL: process.env.NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL,
});
