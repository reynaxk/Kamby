'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAddFunds, usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { Button, cn } from '@kamby/ui';
import { CHAIN_REGISTRY, type EvmChainConfig } from '@kamby/domain';
import { useAccount } from 'wagmi';
import { fetchEvmChainConfigs } from '@/lib/market-client';
import { assetsForChain, SEND_CHAINS, type SendChainOption } from '@/lib/send';
import { TradeModal } from '../trading/TradeModal';
import { ConnectWalletButton } from './ConnectWalletButton';

type Step = 'form' | 'error';

/** Privy's own CAIP-2-shaped chain key for Solana funding — confirmed via privy-config.ts's
 *  own `solana.rpcs` key ('solana:mainnet'), the one other place this codebase already
 *  passes a chain string to this same Privy SDK surface. Not the full CAIP-2 genesis-hash
 *  form (`solana:5eykt4...`) — Privy's own shorthand, same convention reused here rather
 *  than guessed independently. */
const SOLANA_FUND_CHAIN = 'solana:mainnet';

/**
 * Entry point for buying crypto with a card, straight into the user's own embedded wallet —
 * see docs (this session's fomo-gap research) for why Privy's own `useAddFunds` was picked
 * over integrating a separate on-ramp vendor: it's already the wallet provider this app
 * uses, needs no new KYC vendor relationship, and (per its own type doc comment) is the
 * *only* current Privy hook that surfaces the Stripe fiat on-ramp — the older `useFundWallet`
 * does not, even when Stripe is enabled in the dashboard, which is why this uses `useAddFunds`
 * and not that hook despite `useAddFunds` still being `@experimental` in Privy's own types.
 *
 * Deliberately thin: unlike SendModal (a full custom form), Privy's `fund()` call opens
 * Privy's *own* modal to handle payment method, amount, and KYC — this component's only job
 * is picking which chain to fund and resolving *this* wallet's own address for it, reusing
 * SendModal's exact SEND_CHAINS picker (and the same ConnectWalletButton gating) rather than
 * a second, parallel implementation.
 *
 * USDC only, not native currency (ETH/BNB/SOL) — `AddFundsDestination.asset` is typed as a
 * plain required token-address string with only a token-address example in Privy's own
 * type docs; there's no documented sentinel here for "the chain's native asset" and this
 * wasn't worth guessing at for a first version. Every chain this app trades on already has a
 * real, unambiguous USDC address (assetsForChain's own token entry) and "buy USDC" is the
 * natural onramp target for a trading app anyway — narrow scope on purpose, not a limitation
 * to route around silently.
 *
 * Requires the funding provider to actually be enabled in the Privy Dashboard
 * (Configuration → Funding) — an account-level toggle only a human can flip, not something
 * this code can do. Until that's on, Privy's `fund()` call will fail; this component doesn't
 * know or check that state in advance (Privy's SDK doesn't expose it), so a failure here
 * surfaces the same generic error state a real payment failure would.
 */
export function FundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const { address: evmAddress, chainId: evmChainId } = useAccount();
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaWallet = solanaWallets[0];
  const { addFunds } = useAddFunds();

  const [chain, setChain] = useState<SendChainOption>(SEND_CHAINS[1]!); // Base — matches privyConfig.defaultChain
  const [evmChainConfigs, setEvmChainConfigs] = useState<EvmChainConfig[]>([]);
  const usdc = useMemo(() => assetsForChain(chain, evmChainConfigs).find((a) => a.kind === 'token') ?? null, [chain, evmChainConfigs]);
  const [step, setStep] = useState<Step>('form');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchEvmChainConfigs()
      .then(setEvmChainConfigs)
      .catch(() => setEvmChainConfigs([]));
  }, []);

  function reset() {
    setStep('form');
    setFlowError(null);
    setSubmitting(false);
  }

  function close() {
    reset();
    onClose();
  }

  const isConnectedForChain =
    chain.kind === 'evm' ? Boolean(evmAddress) && evmChainId === chain.evmChainId : Boolean(solanaWallet);

  async function startFunding() {
    const address = chain.kind === 'evm' ? evmAddress : solanaWallet?.address;
    if (!address || !usdc?.address) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      await addFunds({
        destination: {
          address,
          chain: chain.kind === 'evm' ? CHAIN_REGISTRY[chain.slug === 'bnb' ? 'bnb' : 'base'].identifier : SOLANA_FUND_CHAIN,
          asset: usdc.address,
        },
        fiat: {},
      });
      close(); // Privy's own modal already showed submitted/confirmed status before returning
    } catch (err) {
      setFlowError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
      setStep('error');
      setSubmitting(false);
    }
  }

  return (
    <TradeModal open={open} onClose={close}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-ink-900">Fund wallet</h2>
        <button type="button" onClick={close} className="font-body text-sm text-ink-400 hover:text-ink-900">
          Close
        </button>
      </div>

      {step === 'form' && (
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <div className="font-body text-xs text-ink-600">Network</div>
            <div className="mt-1.5 flex gap-1.5">
              {SEND_CHAINS.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => setChain(c)}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 font-body text-xs font-semibold transition-colors',
                    chain.slug === c.slug
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {!isConnectedForChain ? (
            chain.kind === 'evm' ? (
              <ConnectWalletButton expectedChainId={chain.evmChainId} />
            ) : (
              <Button type="button" className="w-full" disabled={!ready || authenticated} onClick={() => login()}>
                {!ready ? 'Loading…' : authenticated ? 'Setting up your wallet…' : 'Sign in'}
              </Button>
            )
          ) : (
            <>
              <p className="font-body text-xs text-ink-400">
                Buy USDC with a card, straight into your {chain.name} wallet. Continuing opens Privy&rsquo;s secure
                payment flow.
              </p>
              <Button type="button" className="w-full" disabled={submitting || !usdc?.address} onClick={() => void startFunding()}>
                {submitting ? 'Opening…' : 'Continue'}
              </Button>
            </>
          )}
        </div>
      )}

      {step === 'error' && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-down">Couldn&rsquo;t start funding</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('form')}>
              Try again
            </Button>
            <Button type="button" className="flex-1" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      )}
    </TradeModal>
  );
}
