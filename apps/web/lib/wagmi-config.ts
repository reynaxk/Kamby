// createConfig comes from @privy-io/wagmi, not wagmi directly — a documented,
// drop-in-compatible replacement (used identically: same chains/connectors/transports
// shape) that's required for Privy's embedded EVM wallets to work through standard wagmi
// hooks/actions. `http` itself still comes from plain `wagmi` — Privy only replaces
// `createConfig`, not the transport helpers. See app/providers.tsx for the matching
// WagmiProvider swap, and lib/privy-config.ts's own doc comment for the full picture.
import { createConfig } from '@privy-io/wagmi';
import { http } from 'wagmi';
import { base, bsc } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { clientEnv } from './env';

/**
 * Phase 3 — see docs/TRADING.md#chain-scope. `injected()` covers every desktop
 * browser-extension wallet (MetaMask, Rabby, and Coinbase Wallet's own extension all inject
 * the same EIP-1193 interface) and any mobile wallet's in-app browser, discovered via
 * EIP-6963 (wagmi's `multiInjectedProviderDiscovery`, on by default) rather than any
 * hand-maintained per-wallet flag — see the 2026-09-15 Trust Wallet incident note below for
 * why that distinction matters. WalletConnect (true QR-code mobile pairing, including
 * Coinbase Wallet mobile) is additive and optional — simply omitted, never broken, when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't configured. `wagmi/connectors`' own
 * `coinbaseWallet()` connector is deliberately not used here: as of the versions this
 * monorepo pins, it pulls in `@coinbase/cdp-sdk`'s optional x402-payments code path, which
 * references packages (`@x402/evm`) that aren't installed and that Next's webpack build
 * fails trying to resolve statically — a real upstream packaging issue, not something this
 * app can silence via config, and not worth the dependency weight for a feature (in-wallet
 * payments) this app doesn't use. See docs/TRADING.md#wallet-connectivity.
 *
 * As of 2026-09-15, this config's primary entry point is Privy's own unified login modal
 * (ConnectWalletButton.tsx triggers `usePrivy().login()`), not a bespoke connector-picker
 * UI — `loginMethods: ['email', 'google', 'apple', 'wallet']` in lib/privy-config.ts means
 * a user who prefers an external wallet still reaches the *same* `injected()`/
 * `walletConnect()` connectors defined here, just through Privy's modal instead of a custom
 * dropdown. Nothing below was removed for that change — only how a user reaches it.
 *
 * A named Trust Wallet target used to be added explicitly here, alongside the generic
 * `injected()`, because Trust Wallet's extension didn't reliably announce itself via
 * EIP-6963 at the time that was verified — without it, Trust Wallet never appeared in the
 * connector list at all. Removed 2026-09-15: confirmed via Trust Wallet's own current
 * developer docs (https://developer.trustwallet.com/developer/develop-for-trust/browser-extension/evm)
 * that they now support EIP-6963 and explicitly recommend using it. Keeping the manual
 * target caused a real, live bug — wagmi's `multiInjectedProviderDiscovery` (on by default)
 * already auto-discovers Trust Wallet via EIP-6963 as its own working connector, so the
 * manual entry became a *second*, identically-named "Trust Wallet" option whose
 * `provider: 'isTrust'` legacy-flag lookup silently found nothing (the extension no longer
 * sets that flag) — a dead menu item indistinguishable from the working one, clicking it
 * did nothing with no visible error (see ConnectWalletButton's own fix for the second half
 * of that gap). One connector, not two, now — let EIP-6963 discovery do this the way every
 * wallet vendor currently recommends, rather than hand-maintaining a per-wallet flag that
 * can silently go stale exactly like this one did.
 *
 * BNB Chain (`bsc`) is included alongside Base as of 2026-09-15's Privy migration — in
 * scope per the same request that asked for BUY/SELL execution "on Solana, Base, and BNB
 * via OpenOcean". `http(clientEnv.NEXT_PUBLIC_CHAIN_BNB_RPC_URL)` falls back to BSC's own
 * public default RPC when that env var isn't set (confirmed via viem's actual `http`
 * transport source: `url || chain?.rpcUrls.default.http[0]` — the same bare-`http()`
 * pattern viem documents, not a guess), so this is never half-initialized even when
 * unconfigured — same reasoning `NEXT_PUBLIC_CHAIN_RPC_URL` already relies on for Base's own
 * transport. Listing `bsc` here only makes wagmi *recognize* BNB Chain if a signed-in
 * wallet happens to be on it; it does not make the trading UI support it —
 * ConnectWalletButton.tsx's "wrong network" check still hardcodes `base.id`, and no trading
 * route offers BNB yet (apps/api's own `CHAINS` env var still excludes `"bnb"`; see
 * docs/MULTICHAIN_OCTOBER_PLAN.md). Enabling BNB trading end-to-end is separate, later work.
 * A `Record<8453 | 56, Transport>` (both keys required, unconditionally) is also the only
 * shape wagmi's own types accept once `bsc` is a chains member — conditionally omitting a
 * transport key isn't expressible without fighting the type system for no runtime benefit,
 * given the fallback above already makes an unset BNB RPC URL harmless.
 */
export const wagmiConfig = createConfig({
  chains: [base, bsc],
  connectors: [
    injected(),
    ...(clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID })]
      : []),
  ],
  transports: {
    [base.id]: http(clientEnv.NEXT_PUBLIC_CHAIN_RPC_URL),
    [bsc.id]: http(clientEnv.NEXT_PUBLIC_CHAIN_BNB_RPC_URL),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
