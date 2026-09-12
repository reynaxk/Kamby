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
 */
export const privyAppId = clientEnv.NEXT_PUBLIC_PRIVY_APP_ID ?? null;

export const privyConfig = {
  embeddedWallets: {
    solana: {
      createOnLogin: 'users-without-wallets' as const,
    },
  },
};
