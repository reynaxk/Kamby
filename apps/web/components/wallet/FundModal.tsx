'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAddFunds, usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { Button, cn } from '@kamby/ui';
import { CHAIN_REGISTRY, type EvmChainConfig } from '@kamby/domain';
import QRCode from 'qrcode';
import { useAccount } from 'wagmi';
import { fetchEvmChainConfigs } from '@/lib/market-client';
import { assetsForChain, SEND_CHAINS, type SendChainOption } from '@/lib/send';
import { TradeModal } from '../trading/TradeModal';
import { ConnectWalletButton } from './ConnectWalletButton';

type Step = 'choose' | 'deposit' | 'buy' | 'error';

/** Privy's own CAIP-2-shaped chain key for Solana funding — the same 'solana:mainnet' key
 *  privy-config.ts's `solana.rpcs` uses. */
const SOLANA_FUND_CHAIN = 'solana:mainnet';

/**
 * Deposit (2026-10-03, user's spec): a new user sees $0.00 and adds USDC one of two ways —
 *  1. **Deposit USDC** from another wallet or exchange: pick Base, BNB Chain or Solana and get
 *     this wallet's own address for it (text, QR, copy) with a "USDC on <network> only" warning.
 *  2. **Buy with Apple Pay / Google Pay / card** through Privy's `useAddFunds` (the only Privy
 *     hook that surfaces the Stripe on-ramp; its providers offer Apple/Google Pay where the
 *     device supports them). USDC only — Kamby users only ever hold USDC.
 * Requires the funding providers to be enabled in the Privy Dashboard (Configuration →
 * Funding); if they aren't, `addFunds` fails and the error step says so.
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
  const [step, setStep] = useState<Step>('choose');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchEvmChainConfigs()
      .then(setEvmChainConfigs)
      .catch(() => setEvmChainConfigs([]));
  }, []);

  function close() {
    setStep('choose');
    setFlowError(null);
    setSubmitting(false);
    onClose();
  }

  // The same EVM address receives on Base and BNB Chain; Solana has its own.
  const depositAddress = chain.kind === 'evm' ? evmAddress : solanaWallet?.address;
  const isConnectedForChain =
    chain.kind === 'evm' ? Boolean(evmAddress) && evmChainId === chain.evmChainId : Boolean(solanaWallet);

  async function startFunding() {
    if (!depositAddress || !usdc?.address) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      await addFunds({
        destination: {
          address: depositAddress,
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

  const networkPicker = (
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
  );

  const back = (
    <button type="button" onClick={() => setStep('choose')} className="font-body text-xs text-ink-400 hover:text-ink-900">
      ← Other ways to add funds
    </button>
  );

  return (
    <TradeModal open={open} onClose={close}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-ink-900">{step === 'buy' ? 'Buy USDC' : 'Deposit'}</h2>
        <button type="button" onClick={close} className="font-body text-sm text-ink-400 hover:text-ink-900">
          Close
        </button>
      </div>

      {!authenticated ? (
        <div className="mt-4">
          <Button type="button" className="w-full" disabled={!ready} onClick={() => login()}>
            {!ready ? 'Loading…' : 'Sign in to deposit'}
          </Button>
        </div>
      ) : step === 'choose' ? (
        <div className="mt-4 flex flex-col gap-2">
          <MethodButton title="Deposit USDC" detail="From another wallet or an exchange — on Base, BNB Chain or Solana." onClick={() => setStep('deposit')} />
          <MethodButton
            title="Buy with Apple Pay, Google Pay or card"
            detail="Pay in your own currency; USDC lands straight in your Kamby wallet."
            onClick={() => setStep('buy')}
          />
        </div>
      ) : step === 'deposit' ? (
        <div className="mt-4 flex flex-col gap-4">
          {networkPicker}
          {depositAddress ? (
            <DepositAddress address={depositAddress} networkName={chain.name} />
          ) : (
            <p className="font-body text-sm text-ink-600">Setting up your {chain.name} wallet…</p>
          )}
          {back}
        </div>
      ) : step === 'buy' ? (
        <div className="mt-4 flex flex-col gap-4">
          {networkPicker}
          {!isConnectedForChain ? (
            chain.kind === 'evm' ? (
              <ConnectWalletButton expectedChainId={chain.evmChainId} />
            ) : (
              <p className="font-body text-sm text-ink-600">Setting up your Solana wallet…</p>
            )
          ) : (
            <>
              <p className="font-body text-xs text-ink-400">
                Apple Pay and Google Pay show up when your device supports them. Continuing opens Privy&rsquo;s secure payment
                flow; USDC arrives in your {chain.name} wallet.
              </p>
              <Button type="button" className="w-full" disabled={submitting || !usdc?.address} onClick={() => void startFunding()}>
                {submitting ? 'Opening…' : 'Continue'}
              </Button>
            </>
          )}
          {back}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-down">Couldn&rsquo;t start the purchase</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('buy')}>
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

function MethodButton({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-left transition-colors hover:border-accent/60">
      <div className="font-display text-sm font-semibold text-ink-900">{title}</div>
      <div className="mt-0.5 font-body text-xs text-ink-600">{detail}</div>
    </button>
  );
}

/** This wallet's own address for the picked network: text, a QR code and a copy button. */
function DepositAddress({ address, networkName }: { address: string; networkName: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(address, { margin: 1, width: 200 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <div className="flex flex-col items-center gap-3">
      {qr && (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL
        <img src={qr} alt={`QR code for your ${networkName} address`} className="h-40 w-40 rounded-lg bg-white p-1.5" />
      )}
      <div className="w-full break-all rounded-lg border border-line bg-surface-raised px-3 py-2 text-center font-mono text-xs text-ink-900">{address}</div>
      <Button
        type="button"
        className="w-full"
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied!' : 'Copy address'}
      </Button>
      <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-body text-xs text-ink-900">
        Send only <span className="font-semibold">USDC</span> on <span className="font-semibold">{networkName}</span> to this address.
        Other coins or networks can be lost.
      </p>
    </div>
  );
}
