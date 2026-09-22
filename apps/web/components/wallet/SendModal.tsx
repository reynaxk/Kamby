'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignAndSendTransaction, useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { getAccount, getAssociatedTokenAddress, TokenAccountNotFoundError } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { Button, cn } from '@kamby/ui';
import type { EvmChainConfig } from '@kamby/domain';
import bs58 from 'bs58';
import { formatUnits, parseUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import { fetchEvmChainConfigs } from '@/lib/market-client';
import { solanaConnection } from '@/lib/solana-config';
import {
  assetsForChain,
  buildSolanaNativeTransferTx,
  buildSolanaTokenTransferTx,
  estimateNativeSendReserve,
  isValidDestination,
  readEvmTokenDecimals,
  sendEvmNative,
  sendEvmToken,
  SEND_CHAINS,
  SOLANA_FEE_RESERVE_LAMPORTS,
  type SendAsset,
  type SendChainOption,
} from '@/lib/send';
import { TradeModal } from '../trading/TradeModal';
import { ConnectWalletButton } from './ConnectWalletButton';

type Step = 'form' | 'review' | 'signing' | 'confirmed' | 'failed';

function friendlyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

/** Reads the connected wallet's real balance of `asset` on `chain` — one hook covering all
 *  four cases (EVM native/token via wagmi's own useBalance, Solana native via a live RPC
 *  balance read, Solana token via its Associated Token Account) so the rest of this file
 *  doesn't need four separate branches. Returns `null` while unknown/loading — never a
 *  fabricated 0, same discipline SolAmountInput.tsx/UsdPresetAmountInput.tsx already
 *  establish for exactly this reason. */
function useAssetBalance(
  chain: SendChainOption,
  asset: SendAsset,
  evmAddress: `0x${string}` | undefined,
  solanaAddress: string | undefined,
): bigint | null {
  const { data: evmBalance } = useBalance({
    address: chain.kind === 'evm' ? evmAddress : undefined,
    token: chain.kind === 'evm' && asset.kind === 'token' ? (asset.address as `0x${string}`) : undefined,
    chainId: chain.evmChainId,
    query: { enabled: chain.kind === 'evm' && Boolean(evmAddress), refetchInterval: 15_000 },
  });

  const [solanaBalance, setSolanaBalance] = useState<bigint | null>(null);

  useEffect(() => {
    setSolanaBalance(null);
    if (chain.kind !== 'solana' || !solanaAddress || !solanaConnection) return;
    let cancelled = false;

    async function load() {
      try {
        const owner = new PublicKey(solanaAddress!);
        if (asset.kind === 'native') {
          const lamports = await solanaConnection!.getBalance(owner, 'confirmed');
          if (!cancelled) setSolanaBalance(BigInt(lamports));
          return;
        }
        const mint = new PublicKey(asset.address!);
        const ata = await getAssociatedTokenAddress(mint, owner);
        const account = await getAccount(solanaConnection!, ata);
        if (!cancelled) setSolanaBalance(account.amount);
      } catch (error) {
        if (!cancelled) setSolanaBalance(error instanceof TokenAccountNotFoundError ? 0n : null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chain.kind, asset.kind, asset.address, solanaAddress]);

  if (chain.kind === 'evm') return evmBalance?.value ?? null;
  return solanaBalance;
}

/**
 * A plain wallet-to-wallet transfer from the user's own already-connected wallet to an
 * arbitrary destination they type in — Solana, Base, and BNB Chain, native currency or
 * USDC, entirely non-custodial (Kamby never holds the funds; see lib/send.ts's own doc
 * comment). Reuses TradeModal's shell and ConnectWalletButton's own connect/wrong-network
 * gating verbatim — the exact same pattern TradePanel.tsx already establishes for "gate a
 * form behind a connected wallet on the right chain," not a second bespoke mechanism.
 *
 * Real-money irreversibility drives most of the shape here: a review step between the form
 * and actually signing (same as every trade flow in this app), layered destination-address
 * validation (lib/send.ts's isValidDestination — format regex plus a real decode/checksum
 * check), decimals read live on-chain for any EVM token rather than assumed, and a gas/fee
 * reserve subtracted from "Max" so a 100%-balance native send can never leave the wallet
 * unable to pay for its own transaction.
 */
export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ready, authenticated, login } = usePrivy();
  const { address: evmAddress, chainId: evmChainId } = useAccount();
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaWallet = solanaWallets[0];
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [chain, setChain] = useState<SendChainOption>(SEND_CHAINS[1]!); // Base
  const [evmChainConfigs, setEvmChainConfigs] = useState<EvmChainConfig[]>([]);
  const assets = useMemo(() => assetsForChain(chain, evmChainConfigs), [chain, evmChainConfigs]);
  const [asset, setAsset] = useState<SendAsset>(assets[0]!);
  const [tokenDecimals, setTokenDecimals] = useState<number | null>(asset.decimals);

  const [amountDisplay, setAmountDisplay] = useState('');
  const [destination, setDestination] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [txResult, setTxResult] = useState<string | null>(null);

  useEffect(() => {
    fetchEvmChainConfigs()
      .then(setEvmChainConfigs)
      .catch(() => setEvmChainConfigs([]));
  }, []);

  // Re-pick a default asset (native) whenever the chain changes — the previous asset may not
  // exist on the new chain at all (e.g. switching away from a chain with no USDC configured).
  useEffect(() => {
    setAsset(assets[0]!);
    setAmountDisplay('');
  }, [chain, assets]);

  // EVM token decimals are never assumed — read live once an EVM token asset is selected.
  useEffect(() => {
    setTokenDecimals(asset.decimals);
    if (chain.kind !== 'evm' || asset.kind !== 'token' || !asset.address || asset.decimals !== null) return;
    let cancelled = false;
    readEvmTokenDecimals(asset.address, chain.evmChainId!)
      .then((d) => {
        if (!cancelled) setTokenDecimals(d);
      })
      .catch(() => {
        if (!cancelled) setTokenDecimals(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chain, asset]);

  const balance = useAssetBalance(chain, asset, evmAddress, solanaWallet?.address);

  const amountRaw = useMemo(() => {
    if (!amountDisplay || tokenDecimals === null) return null;
    try {
      return parseUnits(amountDisplay, tokenDecimals);
    } catch {
      return null;
    }
  }, [amountDisplay, tokenDecimals]);

  const destinationValid = destination.trim().length > 0 && isValidDestination(chain.kind, destination);
  const amountValid = amountRaw !== null && amountRaw > 0n && (balance === null || amountRaw <= balance);
  const canReview = destinationValid && amountValid && tokenDecimals !== null;

  function reset() {
    setStep('form');
    setFlowError(null);
    setTxResult(null);
    setAmountDisplay('');
    setDestination('');
  }

  function close() {
    reset();
    onClose();
  }

  async function applyMax() {
    if (balance === null || tokenDecimals === null) return;
    let spendable = balance;
    if (asset.kind === 'native') {
      if (chain.kind === 'solana') {
        spendable = balance > SOLANA_FEE_RESERVE_LAMPORTS ? balance - SOLANA_FEE_RESERVE_LAMPORTS : 0n;
      } else {
        // Always reserve *something* for gas, even before a destination is typed yet — a
        // real bug caught in review: gating this behind `destinationValid` meant clicking
        // Max on a fresh form set the amount to the *entire* native balance with nothing
        // left to pay for the transaction sending it. Estimates against the real
        // destination once one's typed; against the connected address itself otherwise —
        // a plain native transfer's gas cost doesn't meaningfully depend on which EOA
        // receives it, so that's a reasonable stand-in target, never a skipped estimate.
        const gasTarget = (destinationValid ? destination.trim() : evmAddress) as `0x${string}` | undefined;
        const reserve = gasTarget ? await estimateNativeSendReserve(chain.evmChainId!, gasTarget) : 0n;
        spendable = balance > reserve ? balance - reserve : 0n;
      }
    }
    setAmountDisplay(formatUnits(spendable, tokenDecimals));
  }

  async function confirmSend() {
    if (!amountRaw || tokenDecimals === null) return;
    setStep('signing');
    setFlowError(null);
    try {
      const to = destination.trim();
      let result: string;
      if (chain.kind === 'evm') {
        result =
          asset.kind === 'native'
            ? await sendEvmNative(to as `0x${string}`, amountRaw, chain.evmChainId!)
            : await sendEvmToken(asset.address as `0x${string}`, to as `0x${string}`, amountRaw, chain.evmChainId!);
      } else {
        if (!solanaConnection || !solanaWallet) throw new Error('Solana wallet not connected.');
        const from = new PublicKey(solanaWallet.address);
        const toKey = new PublicKey(to);
        const tx =
          asset.kind === 'native'
            ? await buildSolanaNativeTransferTx(solanaConnection, from, toKey, amountRaw)
            : await buildSolanaTokenTransferTx(solanaConnection, from, toKey, new PublicKey(asset.address!), amountRaw);
        // No local signature exists yet at all (Privy's wallet supplies it) — both flags off,
        // matching the standard "serialize for an external signer" shape.
        const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
        const { signature } = await signAndSendTransaction({ transaction: serialized, wallet: solanaWallet });
        result = bs58.encode(signature);
      }
      setTxResult(result);
      setStep('confirmed');
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('failed');
    }
  }

  const isConnectedForChain =
    chain.kind === 'evm' ? Boolean(evmAddress) && evmChainId === chain.evmChainId : Boolean(solanaWallet);

  return (
    <TradeModal open={open} onClose={close}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-ink-900">Send</h2>
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

          <div>
            <div className="font-body text-xs text-ink-600">Asset</div>
            <div className="mt-1.5 flex gap-1.5">
              {assets.map((a) => (
                <button
                  key={a.symbol}
                  type="button"
                  onClick={() => setAsset(a)}
                  className={cn(
                    'flex-1 rounded-lg border px-2 py-1.5 font-body text-xs font-semibold transition-colors',
                    asset.symbol === a.symbol
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-line bg-surface-raised text-ink-600 hover:border-accent/60 hover:text-ink-900',
                  )}
                >
                  {a.symbol}
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
              <div>
                <div className="flex items-center justify-between font-body text-xs text-ink-600">
                  <span>Amount ({asset.symbol})</span>
                  {balance !== null && tokenDecimals !== null && (
                    <span>Balance: {Number(formatUnits(balance, tokenDecimals)).toLocaleString('en-US', { maximumFractionDigits: 6 })}</span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={amountDisplay}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '' || /^\d*\.?\d*$/.test(raw)) setAmountDisplay(raw);
                    }}
                    className="w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-lg text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    type="button"
                    disabled={balance === null || tokenDecimals === null}
                    onClick={() => void applyMax()}
                    className="shrink-0 rounded-lg bg-surface-raised px-3 py-2.5 font-body text-xs font-medium text-ink-600 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Max
                  </button>
                </div>
                {amountDisplay && !amountValid && (
                  <p className="mt-1 font-body text-xs text-down">
                    {amountRaw === null ? 'Enter a valid amount.' : 'Amount exceeds your balance.'}
                  </p>
                )}
              </div>

              <div>
                <div className="font-body text-xs text-ink-600">
                  Destination address ({chain.kind === 'evm' ? '0x…' : 'base58'})
                </div>
                <input
                  type="text"
                  placeholder={chain.kind === 'evm' ? '0x…' : 'Solana address'}
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {destination.trim().length > 0 && !destinationValid && (
                  <p className="mt-1 font-body text-xs text-down">That doesn&rsquo;t look like a valid {chain.name} address.</p>
                )}
              </div>

              <Button type="button" className="w-full" disabled={!canReview} onClick={() => setStep('review')}>
                Review
              </Button>
            </>
          )}
        </div>
      )}

      {step === 'review' && tokenDecimals !== null && amountRaw !== null && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface-raised p-3 font-body text-sm text-ink-900">
            <Row label="Network" value={chain.name} />
            <Row label="Asset" value={asset.symbol} />
            <Row label="Amount" value={`${formatUnits(amountRaw, tokenDecimals)} ${asset.symbol}`} />
            <Row label="To" value={destination.trim()} mono />
          </div>
          <p className="font-body text-xs text-down">
            This sends real funds directly from your wallet and can&rsquo;t be reversed. Double-check the address.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('form')}>
              Back
            </Button>
            <Button type="button" className="flex-1" onClick={() => void confirmSend()}>
              Confirm &amp; Send
            </Button>
          </div>
        </div>
      )}

      {step === 'signing' && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-body text-sm text-ink-600">Confirm this in your wallet…</p>
        </div>
      )}

      {step === 'confirmed' && txResult && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-up">Sent</p>
          <a
            href={chain.txExplorerUrl(txResult)}
            target="_blank"
            rel="noreferrer"
            className="font-body text-xs text-accent underline-offset-2 hover:underline"
          >
            View on {chain.explorerName} →
          </a>
          <Button type="button" className="w-full" onClick={close}>
            Done
          </Button>
        </div>
      )}

      {step === 'failed' && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-down">Send failed</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('review')}>
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

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 last:border-b-0">
      <span className="text-ink-400">{label}</span>
      <span className={cn('truncate text-right', mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}
