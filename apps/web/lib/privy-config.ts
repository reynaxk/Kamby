import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { clientEnv } from './env';

/**
 * Solana trading — see docs/TRADING.md#solana. `null` when NEXT_PUBLIC_PRIVY_APP_ID isn't
 * configured, mirroring apps/api's `getSolanaConfig` returning `null` when SOLANA_ENABLED
 * is off: every consumer (app/providers.tsx, SolanaTradePanel) must handle "not configured"
 * explicitly rather than half-initializing.
 *
 * `embeddedWallets.solana.createOnLogin: 'users-without-wallets'` — a fresh login gets a
 * Solana embedded wallet automatically only if they don't already have one (e.g. via an
 * external wallet connector), matching Privy's own documented default recipe for this
 * shape. Written against Privy's React setup docs as fetched at the time this was built;
 * re-verify the config shape against Privy's current docs (https://docs.privy.io) before
 * depending on this in production, same caveat this codebase already carries for
 * LiFiSwapRouter/JupiterQuoteService's third-party API integrations.
 *
 * `solana.rpcs` — confirmed live on 2026-09-13, required and separate from
 * `lib/solana-config.ts`'s own read-only `Connection`: Privy's `useSignAndSendTransaction`
 * (and the other Solana standard-wallet hooks) build their own `@solana/kit` RPC client
 * internally and throw `No RPC configuration found for chain solana:mainnet` if this isn't
 * supplied, rather than falling back to some public default. Reuses the same
 * NEXT_PUBLIC_SOLANA_RPC_URL already configured for the read-only connection — Helius (and
 * most providers) serve the websocket subscription API off the same host, just `wss://`
 * instead of `https://`.
 */
export const privyAppId = clientEnv.NEXT_PUBLIC_PRIVY_APP_ID ?? null;

const solanaRpcUrl = clientEnv.NEXT_PUBLIC_SOLANA_RPC_URL;

export const privyConfig = {
  embeddedWallets: {
    solana: {
      createOnLogin: 'users-without-wallets' as const,
    },
  },
  ...(solanaRpcUrl && {
    solana: {
      rpcs: {
        'solana:mainnet': {
          rpc: createSolanaRpc(solanaRpcUrl),
          rpcSubscriptions: createSolanaRpcSubscriptions(solanaRpcUrl.replace(/^http/, 'ws')),
          blockExplorerUrl: 'https://solscan.io',
        },
      },
    },
  }),
};
