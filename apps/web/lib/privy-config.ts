import type { PrivyClientConfig } from '@privy-io/react-auth';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { base, bsc } from 'wagmi/chains';
import { clientEnv } from './env';

/**
 * Solana + EVM embedded-wallet auth — see docs/TRADING.md#solana and
 * docs/MULTICHAIN_OCTOBER_PLAN.md's Privy-for-EVM section. `null` when
 * NEXT_PUBLIC_PRIVY_APP_ID isn't configured, mirroring apps/api's `getSolanaConfig`
 * returning `null` when SOLANA_ENABLED is off: every consumer (app/providers.tsx,
 * SolanaTradePanel) must handle "not configured" explicitly rather than half-initializing.
 *
 * `embeddedWallets.solana`/`embeddedWallets.ethereum`, both `createOnLogin:
 * 'users-without-wallets'` — a fresh login gets an embedded wallet on each chain family
 * automatically only if the user doesn't already have one there (e.g. via an external
 * wallet connector), matching Privy's own documented default recipe for this shape. Privy
 * supports unified Solana + EVM accounts under one user natively — this is one login
 * producing both, not two separate flows. `ethereum` added 2026-09-15, replacing wagmi's
 * extension-only connect flow as the primary EVM path — see wagmi-config.ts and
 * app/providers.tsx for the other two pieces of that change; TradePanel.tsx's own signing
 * logic needed zero changes, since it already goes through `@kamby/web`'s shared
 * `wagmiConfig` object via `wagmi/actions`, which `@privy-io/wagmi`'s `createConfig` is a
 * documented drop-in-compatible replacement for.
 *
 * `loginMethods`/`appearance` also added 2026-09-15: `wallet` is kept in `loginMethods`
 * alongside email/social specifically so a user who prefers an existing extension can still
 * connect one through Privy's own unified modal — nothing is actually removed, only the
 * bespoke wagmi-connector dropdown UI is, in favor of Privy's single entry point.
 * `appearance` matches the Void theme's own real values (see globals.css's `.kamby-void`
 * block) — Privy's modal previously rendered with zero custom styling, even for the
 * already-live Solana flow.
 *
 * `apple` deliberately excluded from `loginMethods` (2026-09-15, same incident as the
 * `useCreateWallet` workaround below) — confirmed via `GET
 * https://auth.privy.io/api/v1/apps/<app id>` that `apple_oauth: false` server-side (Google
 * was in the same state until enabled + saved in the dashboard's Login methods page,
 * `https://dashboard.privy.io/apps?page=login-methods`). Listing a login method client-side
 * that isn't enabled server-side shows a real button that fails when clicked — exactly what
 * happened with Google before it was enabled. Real Apple Sign-In needs a paid Apple
 * Developer account, a Services ID, and a private key — meaningfully more setup than
 * Google's "flip a toggle" — so it's left off rather than shown broken. Re-add once it's
 * actually configured and confirmed `apple_oauth: true` via the same API check.
 *
 * `defaultChain`/`supportedChains` added 2026-09-16, real incident: with neither set, Privy's
 * own docs say a fresh embedded wallet "will initialize on Ethereum mainnet or the network
 * used in the user's previous session" — not Base. Every brand-new embedded-wallet user was
 * hitting ConnectWalletButton's "Wrong network — Switch to Base" state immediately after
 * their wallet was created, since it started on mainnet (chain 1), not Base (8453). Setting
 * `defaultChain: base` makes new embedded wallets initialize on the chain this app actually
 * trades on; `supportedChains: [base, bsc]` keeps BNB Chain recognized too (still dormant —
 * see wagmi-config.ts — but Privy will otherwise prompt a switch to the *first* supported
 * chain for anything outside the list, and only `base`/`bsc` are chains this app's wagmi
 * config knows about at all).
 *
 * Written against Privy's React setup docs as fetched at the time this was built;
 * re-verify the config shape against Privy's current docs (https://docs.privy.io) before
 * depending on this in production, same caveat this codebase already carries for
 * KyberSwapRouter/JupiterQuoteService's third-party API integrations.
 *
 * `showWalletUIs: false` added 2026-09-16, real user complaint the same night: a single
 * trade can require up to 3 separate wallet interactions (approve, swap, and — for a
 * guaranteed-USDC-fee market — a separate fee-transfer signature; see
 * docs/TRADING.md#guaranteed-usdc-fees), and Privy's default behavior pops its own
 * confirmation UI for *each* embedded-wallet signature on top of that. Turning it off makes
 * every embedded-wallet signature happen silently/instantly instead. This is safe to remove
 * here specifically because it's redundant, not load-bearing: both TradePanel.tsx and
 * SolanaTradePanel.tsx already show their own "Review" step (exact amounts, the real quote)
 * before the user clicks an explicit "Confirm & sign" button — Privy's popup was a second
 * confirmation of something the user had already reviewed and explicitly approved in our
 * own UI, not the only safety check. This is a single top-level Privy setting, not
 * per-chain, so it applies to both the Solana and EVM embedded-wallet flows identically —
 * intentional, not an oversight, since the same "we already reviewed it" reasoning holds for
 * both. External wallets (Trust Wallet, MetaMask, etc.) are entirely unaffected — this only
 * controls Privy's own embedded-wallet UI, never a third-party wallet extension's popup.
 *
 * `solana.rpcs` — confirmed live on 2026-09-13, required and separate from
 * `lib/solana-config.ts`'s own read-only `Connection`: Privy's `useSignAndSendTransaction`
 * (and the other Solana standard-wallet hooks) build their own `@solana/kit` RPC client
 * internally and throw `No RPC configuration found for chain solana:mainnet` if this isn't
 * supplied, rather than falling back to some public default. Reuses the same
 * NEXT_PUBLIC_SOLANA_RPC_URL already configured for the read-only connection — Helius (and
 * most providers) serve the websocket subscription API off the same host, just `wss://`
 * instead of `https://`. The EVM side needs no equivalent: wagmi's own `http()` transport
 * (see wagmi-config.ts) already covers everything Privy's EVM hooks need.
 */
export const privyAppId = clientEnv.NEXT_PUBLIC_PRIVY_APP_ID ?? null;

const solanaRpcUrl = clientEnv.NEXT_PUBLIC_SOLANA_RPC_URL;

export const privyConfig = {
  loginMethods: ['email', 'google', 'wallet'] satisfies PrivyClientConfig['loginMethods'],
  defaultChain: base,
  supportedChains: [base, bsc],
  appearance: {
    theme: '#06070A' as const,
    accentColor: '#00FF87' as const,
    logo: 'https://kambesh.com/icon.png',
  },
  embeddedWallets: {
    solana: {
      createOnLogin: 'users-without-wallets' as const,
    },
    ethereum: {
      createOnLogin: 'users-without-wallets' as const,
    },
    showWalletUIs: false,
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
