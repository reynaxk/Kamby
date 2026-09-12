'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignAndSendTransaction, useWallets } from '@privy-io/react-auth/solana';
import { Button, cn } from '@kamby/ui';
import { isQuoteExpired, TRADING_DEFAULTS, type SolanaTradeQuoteDto, type SolanaTradeTransactionDto, type TradeSide } from '@kamby/domain';
import bs58 from 'bs58';
import { useSolanaWalletVerification } from '@/hooks/useSolanaWalletVerification';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { getSolanaQuote, getSolanaTransaction, submitSolanaTransaction } from '@/lib/solana-trading-client';
import { SlippageControl } from './SlippageControl';
import { SolanaQuoteSummary } from './SolanaQuoteSummary';
import { UsdPresetAmountInput } from './UsdPresetAmountInput';

export interface SolanaTradePanelProps {
  tokenMint: string;
  tokenSymbol: string | null;
  initialSide?: TradeSide;
  onClose?: () => void;
}

type Step = 'form' | 'review' | 'signing' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'record-failed';

function friendlyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

/** `Buffer` is a Node global — nothing polyfills it in this browser bundle (Next's
 *  webpack 5 base config dropped automatic Node polyfills), so decode base64 the
 *  browser-native way instead of reaching for it. */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Solana's counterpart to TradePanel.tsx — see that component's own doc comment for the
 * shared "never a false success" principle. Deliberately simpler than the EVM flow: no
 * ERC-20-style approval step (nothing to approve on Solana), and no separate guaranteed-
 * USDC-fee-transfer step (Jupiter's `platformFeeBps`/`feeAccount` deduct the platform fee
 * atomically inside the swap itself — see docs/TRADING.md#solana).
 *
 * Launch scope is non-custodial (see docs/WALLET_SECURITY.md's Solana section): this
 * component signs *and sends* the transaction itself via Privy's embedded wallet
 * (`useSignAndSendTransaction`) — there is no backend co-signer/relayer yet, so unlike the
 * EVM flow's `sendTransaction`, this is the wallet broadcasting on its own, paying its own
 * (tiny) network fee. Only the resulting signature is reported to the backend afterward,
 * to record.
 */
export function SolanaTradePanel({ tokenMint, tokenSymbol, initialSide = 'BUY', onClose }: SolanaTradePanelProps) {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const walletVerification = useSolanaWalletVerification();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(TRADING_DEFAULTS.defaultSlippageBps);
  const [refreshTick, setRefreshTick] = useState(0);

  const [quote, setQuote] = useState<SolanaTradeQuoteDto | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [step, setStep] = useState<Step>('form');
  const [flowError, setFlowError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<SolanaTradeTransactionDto | null>(null);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canQuote = walletVerification.status === 'verified' && Boolean(wallet);

  useEffect(() => {
    if (!canQuote || !amount || Number(amount) <= 0) {
      setQuote(null);
      setQuoteStatus('idle');
      return;
    }
    setQuoteStatus('loading');
    setQuoteError(null);
    const handle = setTimeout(() => {
      getSolanaQuote({ side, tokenMint, walletAddress: wallet!.address, amount, slippageBps })
        .then((result) => {
          setQuote(result);
          setQuoteStatus('ready');
        })
        .catch((err: unknown) => {
          setQuote(null);
          setQuoteStatus('error');
          setQuoteError(friendlyError(err));
        });
    }, 500);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, tokenMint, amount, slippageBps, canQuote, refreshTick]);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (step !== 'submitted' && step !== 'pending') return;
    const id = transaction?.id;
    if (!id) return;
    pollRef.current = setInterval(() => {
      void getSolanaTransaction(id).then((tx) => {
        if (!tx) return;
        setTransaction(tx);
        if (tx.status === 'CONFIRMED') {
          setStep('confirmed');
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (tx.status === 'FAILED' || tx.status === 'EXPIRED') {
          setStep('failed');
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setStep('pending');
        }
      });
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, transaction?.id]);

  const isExpired = quote !== null && isQuoteExpired(new Date(quote.expiresAt), new Date(now));

  async function handleConfirmAndSign() {
    if (!quote || !wallet) return;
    setFlowError(null);
    setStep('signing');
    try {
      const transactionBytes = base64ToUint8Array(quote.unsignedTxBase64);
      const result = await signAndSendTransaction({ transaction: transactionBytes, wallet });
      const signature = bs58.encode(result.signature);
      // A real, broadcast signature must never be discarded just because *recording* it
      // afterward fails — same reasoning as TradePanel's own pendingHash handling.
      setPendingSignature(signature);
      await recordSubmittedTransaction(signature, quote.id, wallet.address);
    } catch (err) {
      setStep('review');
      setFlowError(friendlyError(err));
    }
  }

  async function recordSubmittedTransaction(signature: string, quoteId: string, walletAddress: string) {
    try {
      const tx = await submitSolanaTransaction({ quoteId, walletAddress, signature });
      setTransaction(tx);
      setStep('submitted');
    } catch (err) {
      setStep('record-failed');
      setFlowError(friendlyError(err));
    }
  }

  function handleRetryRecording() {
    if (!pendingSignature || !quote || !wallet) return;
    setFlowError(null);
    void recordSubmittedTransaction(pendingSignature, quote.id, wallet.address);
  }

  function resetToForm() {
    setStep('form');
    setQuote(null);
    setQuoteStatus('idle');
    setTransaction(null);
    setPendingSignature(null);
    setFlowError(null);
    setAmount('');
  }

  // --- Gating states: connect -> verify ----------------------------------------------------

  if (!wallet) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">
          Sign in to trade — Kamby creates a wallet for you automatically, no extension or seed phrase needed. It
          never holds your funds or signs on your behalf.
        </p>
        <Button type="button" className="w-full" disabled={!ready || authenticated} onClick={() => login()}>
          {!ready ? 'Loading…' : authenticated ? 'Setting up your wallet…' : 'Sign in'}
        </Button>
      </Panel>
    );
  }

  if (walletVerification.status !== 'verified') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Verify this wallet with a free signature (no gas, no transaction) before trading with it.</p>
        <Button
          type="button"
          onClick={() => void walletVerification.verify()}
          disabled={walletVerification.status === 'verifying' || walletVerification.status === 'checking'}
        >
          {walletVerification.status === 'verifying' ? 'Check your wallet…' : 'Verify wallet'}
        </Button>
        {walletVerification.status === 'rejected' && walletVerification.error && (
          <p className="font-body text-xs text-down">{walletVerification.error}</p>
        )}
      </Panel>
    );
  }

  // --- Post-trade states --------------------------------------------------------------------

  if (step === 'submitted' || step === 'pending' || step === 'confirmed' || step === 'failed') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <SolanaTradeStatusView step={step} transaction={transaction} signature={pendingSignature} onDone={resetToForm} />
      </Panel>
    );
  }

  if (step === 'record-failed') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <div className="space-y-3 text-center">
          <p className="font-body text-sm font-semibold text-down">Your trade was sent to the network, but we couldn&apos;t record it.</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          {pendingSignature && (
            <a href={`https://solscan.io/tx/${pendingSignature}`} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
              View on Solscan
            </a>
          )}
          <Button type="button" onClick={handleRetryRecording} className="w-full">
            Retry
          </Button>
        </div>
      </Panel>
    );
  }

  // --- Review step --------------------------------------------------------------------------

  if (step === 'review' || step === 'signing') {
    if (!quote) return null;
    return (
      <Panel title="Review trade" onClose={onClose} onBack={step === 'review' ? () => setStep('form') : undefined}>
        <SolanaQuoteSummary quote={quote} />
        {isExpired && (
          <div className="rounded-lg bg-down/10 px-3 py-2 font-body text-xs text-down">
            This quote expired.{' '}
            <button type="button" className="underline" onClick={() => { setRefreshTick((n) => n + 1); setStep('form'); }}>
              Refresh it
            </button>{' '}
            before continuing.
          </div>
        )}
        {flowError && <p className="font-body text-xs text-down">{flowError}</p>}
        <Button type="button" className="w-full" disabled={isExpired || step === 'signing'} onClick={() => void handleConfirmAndSign()}>
          {step === 'signing' ? 'Confirm in your wallet…' : 'Confirm & sign'}
        </Button>
      </Panel>
    );
  }

  // --- Form step -----------------------------------------------------------------------------

  return (
    <Panel title="Trade" onClose={onClose}>
      <div className="flex gap-1.5">
        {(['BUY', 'SELL'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-semibold uppercase tracking-wide',
              side === s ? 'bg-accent text-white' : 'bg-surface-raised text-ink-600 hover:text-ink-900',
            )}
          >
            {s === 'BUY' ? `Buy ${tokenSymbol ?? 'token'}` : `Sell ${tokenSymbol ?? 'token'}`}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-ink-600">
        <span className="truncate">
          Your wallet:{' '}
          <span className="font-mono text-ink-900">
            {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
          </span>
          {' — send USDC (Solana network) here to trade.'}
        </span>
        <CopyAddressButton address={wallet.address} />
      </div>
      <UsdPresetAmountInput value={amount} onChange={setAmount} walletAddress={wallet.address} />
      <SlippageControl valueBps={slippageBps} onChange={setSlippageBps} />
      {quoteStatus === 'error' && quoteError && <p className="font-body text-xs text-down">{quoteError}</p>}
      <Button
        type="button"
        className="w-full"
        disabled={quoteStatus !== 'ready' || !quote}
        onClick={() => setStep('review')}
      >
        {quoteStatus === 'loading' ? 'Getting quote…' : 'Review trade'}
      </Button>
    </Panel>
  );
}

function Panel({ title, onClose, onBack, children }: { title: string; onClose?: () => void; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onBack && (
            <button type="button" onClick={onBack} aria-label="Back" className="text-ink-600 hover:text-ink-900">
              ←
            </button>
          )}
          <h2 className="font-display text-base font-semibold text-ink-900">{title}</h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-600 hover:text-ink-900">
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SolanaTradeStatusView({
  step,
  transaction,
  signature,
  onDone,
}: {
  step: 'submitted' | 'pending' | 'confirmed' | 'failed';
  transaction: SolanaTradeTransactionDto | null;
  signature: string | null;
  onDone: () => void;
}) {
  const sig = transaction?.signature ?? signature;
  const explorerUrl = sig ? `https://solscan.io/tx/${sig}` : null;

  const label =
    step === 'confirmed' ? 'Trade confirmed' : step === 'failed' ? 'Trade failed' : 'Waiting for confirmation…';
  const color = step === 'confirmed' ? 'text-up' : step === 'failed' ? 'text-down' : 'text-ink-600';

  return (
    <div className="space-y-3 text-center">
      <p className={cn('font-body text-sm font-semibold', color)}>{label}</p>
      {transaction?.failureReason && <p className="font-body text-xs text-ink-600">{transaction.failureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View on Solscan
        </a>
      )}
      {(step === 'confirmed' || step === 'failed') && (
        <Button type="button" onClick={onDone} className="w-full">
          Done
        </Button>
      )}
    </div>
  );
}
