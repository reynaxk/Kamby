import { createConfig, http } from 'wagmi';
import { base } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { clientEnv } from './env';

/**
 * Phase 3 — see docs/TRADING.md#chain-scope. Exactly one chain, matching apps/api's
 * CHAIN_ID (Base). `injected()` covers every desktop browser-extension wallet (MetaMask,
 * Rabby, and Coinbase Wallet's own extension all inject the same EIP-1193 interface) and
 * any mobile wallet's in-app browser. WalletConnect (true QR-code mobile pairing, including
 * Coinbase Wallet mobile) is additive and optional — simply omitted, never broken, when
 * NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID isn't configured. `wagmi/connectors`' own
 * `coinbaseWallet()` connector is deliberately not used here: as of the versions this
 * monorepo pins, it pulls in `@coinbase/cdp-sdk`'s optional x402-payments code path, which
 * references packages (`@x402/evm`) that aren't installed and that Next's webpack build
 * fails trying to resolve statically — a real upstream packaging issue, not something this
 * app can silence via config, and not worth the dependency weight for a feature (in-wallet
 * payments) this app doesn't use. See docs/TRADING.md#wallet-connectivity.
 *
 * A named Trust Wallet target is added explicitly, alongside the generic `injected()`:
 * confirmed live (see docs/TRADING.md#wallet-connectivity) that Trust Wallet's extension
 * does not reliably announce itself via EIP-6963 the way every other tested wallet here
 * does, so without this it never appears in the connector list at all — not a config
 * omission, a real gap in that extension's own behavior. `isTrust`/`isTrustWallet` are
 * Trust Wallet's own documented legacy-detection flags on the injected provider.
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    injected(),
    injected({ target: { id: 'trustWallet', name: 'Trust Wallet', provider: 'isTrust' } }),
    ...(clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      ? [walletConnect({ projectId: clientEnv.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID })]
      : []),
  ],
  transports: {
    [base.id]: http(clientEnv.NEXT_PUBLIC_CHAIN_RPC_URL),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
