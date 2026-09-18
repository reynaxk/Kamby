'use client';

import { useEffect, useRef, useState } from 'react';
import { useCreateWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { Button } from '@kamby/ui';
import { CHAIN_REGISTRY, slugForChainId } from '@kamby/domain';
import { useAccount, useSwitchChain } from 'wagmi';
import { base } from 'wagmi/chains';
import { truncateAddress } from '@/lib/format';

/**
 * Phase 3 — see docs/TRADING.md#wallet-connectivity. Exposes exactly what the trading flow
 * needs to reason about: address, chain id, connection status, sign-out, and — critically —
 * a "Wrong network" state that blocks trading rather than silently executing on whatever
 * chain the wallet happens to be on. Being signed in here is *not* the same as owning the
 * wallet: nothing here proves anything to the API on its own — see
 * hooks/useWalletVerification.ts and components/trading/TradePanel.tsx, which gate trading
 * on a signature-verified wallet.
 *
 * Rewritten 2026-09-15 to trigger Privy's unified login modal (`usePrivy().login()`)
 * instead of a bespoke connector-picker dropdown, mirroring SolanaTradePanel.tsx's own
 * "Sign in" button exactly (same disabled/copy logic) — one entry point for email, Google,
 * Apple, and an existing extension wallet alike (`loginMethods` in lib/privy-config.ts).
 * `useAccount`/`useSwitchChain` below are unchanged, standard wagmi hooks: once Privy signs
 * a user in, `@privy-io/wagmi`'s `useSyncPrivyWallets` (wired in app/providers.tsx) syncs
 * that wallet — embedded or external — into wagmi's own connector state automatically, so
 * everything downstream of "connected" here, and all of TradePanel.tsx's signing logic,
 * needed zero changes.
 *
 * Explicit `useCreateWallet()` call added the same day, same incident: this Privy app's
 * dashboard-side `embedded_wallet_config.ethereum.create_on_login` is `"off"` (confirmed via
 * `GET https://auth.privy.io/api/v1/apps/<app id>` — Privy support confirmed this is a
 * real server-side override, ticket in flight to change it), which silently skips wallet
 * creation on login regardless of the `embeddedWallets.ethereum.createOnLogin` value in
 * lib/privy-config.ts — every user got stuck on "Setting up your wallet…" forever, since
 * `useWallets()` (EVM) never populated and `useSyncPrivyWallets` had nothing to sync into
 * wagmi. Privy's own SDK types document the fix directly: `createOnLogin: "off"` only skips
 * *automatic* creation — "you can always prompt the user to create one manually with your
 * app" via `useCreateWallet()`. That's exactly what the effect below does: once signed in
 * with zero Ethereum wallets, it creates one explicitly, client-side, which works
 * independent of the dashboard's auto-creation setting. Once Privy support flips
 * `create_on_login` to a real value this becomes a no-op (wallets.length is already > 0 by
 * the time it runs), so it's safe to leave in permanently rather than reverting later.
 *
 * There's a real gap between `authenticated` (Privy login done) and `isConnected` (wagmi has
 * finished syncing that wallet) — the "Setting up your wallet…" state below covers exactly
 * that window, same as the Solana flow already does. A visible error (with a retry) covers
 * the case where `createWallet()` itself fails, rather than hanging on that copy forever a
 * second way.
 *
 * Sign-out goes through `usePrivy().logout()`, not wagmi's own `useDisconnect()` — this
 * ends the actual Privy session (and, for an embedded wallet, is the only thing that makes
 * sense to call at all); a bare wagmi disconnect would leave the user's Privy session alive
 * while making the app act as if they'd signed out, an inconsistent state this avoids by
 * construction.
 *
 * Auto-switch added 2026-09-16, same incident as `defaultChain` in lib/privy-config.ts (that
 * fix covers new wallets; this covers a wallet that's already on the wrong chain for some
 * other reason — e.g. an external wallet the user had pointed elsewhere, or a returning
 * embedded-wallet session from before `defaultChain` was set). Previously the wrong-network
 * state was inert until a manual click — for an embedded wallet there's no browser-extension
 * popup in the way, so requiring that click was pure friction, not a safety measure. The
 * effect below attempts `switchChain` automatically, once, the moment a wrong network is
 * detected; it does NOT and cannot bypass an external wallet's own permission prompt (that's
 * the wallet's own security control, e.g. MetaMask's native confirm-switch dialog — this
 * just triggers the same request a manual click would have, proactively instead of waiting).
 * A `hasAttemptedSwitch` ref stops it from retrying every render once it's fired — if it
 * fails (rejected, or any other error), the real error message is shown with a manual retry,
 * never a silent or infinite loop. Resets the moment the wallet is actually on the right
 * chain (or disconnects), so a later disconnect-then-reconnect-wrong gets a fresh attempt.
 *
 * Connected-state dropdown added 2026-09-16, real bug the user hit live: the address button
 * used to call `logout()` directly on click, so there was no way to ever see or copy the
 * full address — clicking it for *any* reason just signed you out, including when a user
 * genuinely needed their own address (e.g. to fund a fresh embedded wallet with gas). Now it
 * opens a small menu with the full address (click to copy, with a real clipboard call and a
 * "Copied!" confirmation) and sign-out as a separate, explicit action.
 *
 * `expectedChainId` added 2026-09-16 for BNB Chain going live: this button used to hardcode
 * `base.id` as "the" correct network everywhere — fine when Base was the only chain Kamby
 * traded on, wrong once a BNB-token trade needs the wallet on chain 56 instead. Callers with
 * real trade context (TradePanel) now pass the chain that specific trade is actually on;
 * callers with no trade context (the header's global connect button) get the `base.id`
 * default, matching this app's existing "Base is the back-compat default" convention
 * (`DEFAULT_CHAIN_ID` in `@kamby/domain`) rather than guessing.
 */
export function ConnectWalletButton({ expectedChainId = base.id }: { expectedChainId?: number } = {}) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { address, isConnected, chainId } = useAccount();
  const expectedChainSlug = slugForChainId(expectedChainId);
  const expectedChainName = expectedChainSlug ? CHAIN_REGISTRY[expectedChainSlug].name : 'the right network';
  const { switchChain, isPending: isSwitching, error: switchChainError } = useSwitchChain();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const [walletSetupError, setWalletSetupError] = useState<string | null>(null);
  const creatingWalletRef = useRef(false);
  const hasAttemptedSwitchRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!ready || !authenticated || !walletsReady) return;
    if (wallets.length > 0 || creatingWalletRef.current) return;

    creatingWalletRef.current = true;
    setWalletSetupError(null);
    createWallet()
      .catch((error: unknown) => {
        setWalletSetupError(error instanceof Error ? error.message : 'Failed to set up wallet');
      })
      .finally(() => {
        creatingWalletRef.current = false;
      });
  }, [ready, authenticated, walletsReady, wallets.length, createWallet]);

  useEffect(() => {
    if (!isConnected || chainId === expectedChainId) {
      hasAttemptedSwitchRef.current = false;
      return;
    }
    if (hasAttemptedSwitchRef.current || isSwitching) return;

    hasAttemptedSwitchRef.current = true;
    // wagmi's own switchChain type narrows `chainId` to the literal union of chains
    // configured in wagmiConfig (currently 8453 | 56) via module augmentation —
    // `expectedChainId` is deliberately plain `number` since this component doesn't know
    // at compile time which chain a given caller will ask for; the cast is safe because
    // every real call site passes a chainId that's actually in that configured set.
    switchChain({ chainId: expectedChainId as 8453 | 56 });
  }, [isConnected, chainId, expectedChainId, isSwitching, switchChain]);

  if (!ready || !authenticated || !isConnected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button type="button" variant="primary" disabled={!ready || authenticated} onClick={() => login()}>
          {!ready ? 'Loading…' : authenticated ? 'Setting up your wallet…' : 'Sign in'}
        </Button>
        {walletSetupError && (
          <button
            type="button"
            onClick={() => {
              setWalletSetupError(null);
              creatingWalletRef.current = false;
            }}
            className="font-body text-xs text-down underline-offset-2 hover:underline"
          >
            {walletSetupError} — tap to retry
          </button>
        )}
      </div>
    );
  }

  if (chainId !== expectedChainId) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="secondary"
          className="border border-down/40 text-down"
          onClick={() => {
            hasAttemptedSwitchRef.current = true;
            switchChain({ chainId: expectedChainId as 8453 | 56 });
          }}
          disabled={isSwitching}
        >
          {isSwitching ? 'Switching…' : `Wrong network — Switch to ${expectedChainName}`}
        </Button>
        {switchChainError && (
          <p className="font-body text-xs text-down">{switchChainError.message}</p>
        )}
      </div>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      <Button type="button" variant="secondary" onClick={() => setMenuOpen((open) => !open)}>
        {truncateAddress(address as string)}
      </Button>
      {menuOpen && (
        <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                .writeText(address as string)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
            className="block w-full truncate rounded-lg px-3 py-2 text-left font-mono text-xs text-ink-900 hover:bg-surface-raised"
          >
            {copied ? 'Copied!' : address}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              logout();
            }}
            className="block w-full rounded-lg px-3 py-2 text-left font-body text-sm text-down hover:bg-surface-raised"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
