'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@kamby/ui';
import { isQuoteExpired, TRADING_DEFAULTS, type TradeQuoteDto, type TradeSide, type TradeTransactionDto } from '@kamby/domain';
import { erc20Abi } from 'viem';
import { useAccount } from 'wagmi';
import { base } from 'wagmi/chains';
import { sendTransaction, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { useWalletVerification } from '@/hooks/useWalletVerification';
import { wagmiConfig } from '@/lib/wagmi-config';
import { getQuote, getTransaction, submitFeeTransaction, submitTransaction } from '@/lib/trading-client';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { AmountInput } from './AmountInput';
import { SlippageControl } from './SlippageControl';
import { QuoteSummary } from './QuoteSummary';

export interface TradePanelProps {
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  quoteTokenAddress: string;
  quoteTokenSymbol: string | null;
  quoteTokenDecimals: number;
  initialSide?: TradeSide;
  onClose?: () => void;
}

type Step = 'form' | 'review' | 'approving' | 'signing' | 'submitted' | 'pending' | 'confirmed' | 'failed' | 'record-failed';

function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err && typeof (err as { shortMessage?: unknown }).shortMessage === 'string') {
    return (err as { shortMessage: string }).shortMessage;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

/**
 * The one shared trade flow every entry point (token page, activity "Trade" action) opens
 * — see docs/TRADING.md#trading-ui. Review → Confirm & sign → wallet popup → submitted →
 * pending → confirmed/failed, never skipping a step and never showing a false success.
 * This component never signs anything itself: `sendTransaction`/`writeContract` below hand
 * the unsigned transaction to whatever wallet wagmi has connected — the wallet is the only
 * thing that ever touches a private key. See docs/WALLET_SECURITY.md.
 */
export function TradePanel({
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  quoteTokenAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  initialSide = 'BUY',
  onClose,
}: TradePanelProps) {
  const { address, isConnected, chainId } = useAccount();
  const walletVerification = useWalletVerification();

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(TRADING_DEFAULTS.defaultSlippageBps);
  const [refreshTick, setRefreshTick] = useState(0);

  const [quote, setQuote] = useState<TradeQuoteDto | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [step, setStep] = useState<Step>('form');
  const [approved, setApproved] = useState(false);
  // Gates signing on an 'extreme' price-impact quote — see docs/TRADING.md#price-impact.
  // Reset alongside `approved` whenever a fresh quote comes in, so an acknowledgement never
  // silently carries over to a different (possibly worse) quote.
  const [priceImpactAcknowledged, setPriceImpactAcknowledged] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [transaction, setTransaction] = useState<TradeTransactionDto | null>(null);
  // Set the moment the wallet successfully broadcasts, cleared only on a fresh trade — see
  // handleConfirmAndSign's comment on why a real on-chain hash must never be discarded just
  // because *recording* it afterward failed.
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The separate guaranteed-USDC fee transfer — see docs/TRADING.md#guaranteed-usdc-fees.
  // Entirely inert when quote.feeUnsignedTx is null (a non-USDC-quoted market): nothing
  // here ever fires, and the flow behaves exactly as it did before this existed.
  const [feeSignState, setFeeSignState] = useState<'idle' | 'signing' | 'record-failed'>('idle');
  const [feeSignError, setFeeSignError] = useState<string | null>(null);
  // Same reasoning as `pendingHash` above: set only once the fee transfer has actually
  // broadcast, so a recording failure retries the record, never re-signs or re-broadcasts.
  const [feePendingHash, setFeePendingHash] = useState<string | null>(null);

  const inputTokenAddress = side === 'BUY' ? quoteTokenAddress : tokenAddress;
  const inputTokenSymbol = side === 'BUY' ? quoteTokenSymbol : tokenSymbol;
  const inputTokenDecimals = side === 'BUY' ? quoteTokenDecimals : tokenDecimals;

  const onBase = chainId === base.id;
  const canQuote = isConnected && onBase && walletVerification.status === 'verified';

  // Debounced quote fetch — never fires for an empty/invalid amount, so opening the panel
  // never itself triggers an API call (see docs/TRADING.md#quote-system).
  useEffect(() => {
    if (!canQuote || !address) return;
    const amountNum = Number.parseFloat(amount);
    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) {
      setQuote(null);
      setQuoteStatus('idle');
      return;
    }
    setQuoteStatus('loading');
    setQuoteError(null);
    setApproved(false);
    setPriceImpactAcknowledged(false);
    const timeout = setTimeout(() => {
      getQuote({ side, tokenAddress, walletAddress: address, amount, slippageBps })
        .then((result) => {
          setQuote(result);
          setQuoteStatus('ready');
        })
        .catch((err: unknown) => {
          setQuote(null);
          setQuoteStatus('error');
          setQuoteError(err instanceof Error ? err.message : 'Could not get a quote');
        });
    }, 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canQuote, side, amount, slippageBps, address, tokenAddress, refreshTick]);

  // Ticks once a second only while a quote is live, purely to re-render the expiry check.
  useEffect(() => {
    if (!quote) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [quote]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const isExpired = quote !== null && isQuoteExpired(new Date(quote.expiresAt), new Date(now));

  /** Polls until the swap resolves *and* (if this trade has a guaranteed-USDC fee) the fee
   *  transfer also resolves — see docs/TRADING.md#guaranteed-usdc-fees. The swap's own
   *  status still drives which top-level step renders the instant it resolves; the fee's
   *  status is read straight off the same polled `transaction` and shown inline (see the
   *  fee section below), never gating the swap's own confirmed/failed outcome. Clears any
   *  previous interval first so a fresh fee submission can safely restart polling even
   *  after the swap side already stopped it. */
  function pollTransactionStatus(id: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      getTransaction(id)
        .then((updated) => {
          if (!updated) return; // transient — try again next tick rather than erroring
          setTransaction(updated);
          if (updated.status !== 'PENDING') {
            setStep(updated.status === 'CONFIRMED' ? 'confirmed' : 'failed');
          }
          const feeStillPending = updated.feeStatus === 'PENDING';
          if (updated.status !== 'PENDING' && !feeStillPending && pollRef.current) {
            clearInterval(pollRef.current);
          }
        })
        .catch(() => {
          // A transient read failure — the next tick tries again; the transaction record
          // itself is unaffected.
        });
    }, 4000);
  }

  async function handleApprove() {
    if (!quote?.approvalSpender) return;
    setFlowError(null);
    setStep('approving');
    try {
      const hash = await writeContract(wagmiConfig, {
        address: inputTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.approvalSpender as `0x${string}`, BigInt(quote.inputAmount)],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setApproved(true);
      setStep('review');
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('review');
    }
  }

  async function handleConfirmAndSign() {
    if (!quote || !address) return;
    if (isQuoteExpired(new Date(quote.expiresAt))) {
      setFlowError('This quote just expired — refresh it before signing.');
      return;
    }
    setFlowError(null);
    setStep('signing');

    let hash: `0x${string}`;
    try {
      hash = await sendTransaction(wagmiConfig, {
        to: quote.unsignedTx.to as `0x${string}`,
        data: quote.unsignedTx.data as `0x${string}`,
        value: BigInt(quote.unsignedTx.value),
        gas: quote.unsignedTx.gas ? BigInt(quote.unsignedTx.gas) : undefined,
        maxFeePerGas: quote.unsignedTx.maxFeePerGas ? BigInt(quote.unsignedTx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: quote.unsignedTx.maxPriorityFeePerGas ? BigInt(quote.unsignedTx.maxPriorityFeePerGas) : undefined,
      });
    } catch (err) {
      // Nothing was broadcast — no real trade exists yet, so it's genuinely safe to send
      // the user back to Review and let them try signing again.
      setFlowError(friendlyError(err));
      setStep('review');
      return;
    }

    // The wallet broadcast successfully — a real, irreversible on-chain transaction now
    // exists. From this point on, a failure must NEVER route back to a step that offers
    // "Confirm & sign" again: that would broadcast a second, separate transaction for the
    // same trade (see docs/TRADING.md's audit note on this exact failure mode).
    setStep('submitted');
    await recordSubmittedTransaction(hash, quote.id, address);
  }

  /** Records an already-broadcast transaction with the backend — split out from
   *  handleConfirmAndSign so a retry (from the record-failed step) can call this directly
   *  with the same hash, never re-signing or re-broadcasting. Safe to call more than once:
   *  submission is idempotent on (quoteId, txHash) — see
   *  docs/TRADING.md#transaction-submission. */
  async function recordSubmittedTransaction(hash: string, quoteId: string, walletAddress: string) {
    try {
      const recorded = await submitTransaction({ quoteId, walletAddress, txHash: hash });
      setTransaction(recorded);
      setPendingHash(null);
      setStep('pending');
      pollTransactionStatus(recorded.id);
    } catch (err) {
      // The trade WAS broadcast — only recording it failed. Keep the hash so the user can
      // verify it themselves and so a retry never needs a new signature.
      setPendingHash(hash);
      setFlowError(friendlyError(err));
      setStep('record-failed');
    }
  }

  function handleRetryRecording() {
    if (!pendingHash || !quote || !address) return;
    setFlowError(null);
    setStep('submitted');
    void recordSubmittedTransaction(pendingHash, quote.id, address);
  }

  /** The second signature for a guaranteed-USDC-fee trade — see
   *  docs/TRADING.md#guaranteed-usdc-fees. A user-initiated action (an explicit button, not
   *  auto-fired after the swap), so a second wallet popup never appears as a surprise. Only
   *  ever reachable once `transaction` exists, i.e. after the swap itself has broadcast. */
  async function handleSignFeeTransfer() {
    if (!quote?.feeUnsignedTx || !transaction) return;
    setFeeSignError(null);
    setFeeSignState('signing');

    let hash: `0x${string}`;
    try {
      hash = await sendTransaction(wagmiConfig, {
        to: quote.feeUnsignedTx.to as `0x${string}`,
        data: quote.feeUnsignedTx.data as `0x${string}`,
        value: BigInt(quote.feeUnsignedTx.value),
        gas: quote.feeUnsignedTx.gas ? BigInt(quote.feeUnsignedTx.gas) : undefined,
        maxFeePerGas: quote.feeUnsignedTx.maxFeePerGas ? BigInt(quote.feeUnsignedTx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: quote.feeUnsignedTx.maxPriorityFeePerGas ? BigInt(quote.feeUnsignedTx.maxPriorityFeePerGas) : undefined,
      });
    } catch (err) {
      // Nothing was broadcast — safe to let the user try signing the fee transfer again.
      setFeeSignError(friendlyError(err));
      setFeeSignState('idle');
      return;
    }

    await recordFeeTransaction(hash, transaction.id);
  }

  /** Same split-out-for-retry reasoning as recordSubmittedTransaction above: once the fee
   *  transfer has actually broadcast, a recording failure must only ever retry the record,
   *  never re-sign or re-broadcast a second fee transfer. */
  async function recordFeeTransaction(hash: string, transactionId: string) {
    try {
      const updated = await submitFeeTransaction(transactionId, hash);
      setTransaction(updated);
      setFeePendingHash(null);
      setFeeSignState('idle');
      // Restarts polling if the swap side already stopped it (e.g. the swap confirmed
      // before the user got around to signing the fee transfer) so this fee's own
      // confirmation still gets picked up.
      pollTransactionStatus(transactionId);
    } catch (err) {
      setFeePendingHash(hash);
      setFeeSignError(friendlyError(err));
      setFeeSignState('record-failed');
    }
  }

  function handleRetryFeeRecording() {
    if (!feePendingHash || !transaction) return;
    setFeeSignError(null);
    void recordFeeTransaction(feePendingHash, transaction.id);
  }

  function resetToForm() {
    setStep('form');
    setQuote(null);
    setQuoteStatus('idle');
    setTransaction(null);
    setPendingHash(null);
    setFlowError(null);
    setAmount('');
    setFeeSignState('idle');
    setFeeSignError(null);
    setFeePendingHash(null);
  }

  // --- Gating states: connect -> right network -> verify ---------------------------------

  if (!isConnected) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Connect a wallet to trade — Kamby never holds your funds or signs on your behalf.</p>
        <ConnectWalletButton />
      </Panel>
    );
  }

  if (!onBase) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Your wallet is on the wrong network for this trade.</p>
        <ConnectWalletButton />
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

  // --- Post-trade states -------------------------------------------------------------------

  if (step === 'submitted' || step === 'pending' || step === 'confirmed' || step === 'failed') {
    return (
      <Panel title="Trade" onClose={onClose}>
        <TradeStatusView step={step} transaction={transaction} chainId={base.id} onDone={resetToForm} />
        {quote?.feeUnsignedTx && transaction && (
          <FeeTransferSection
            transaction={transaction}
            feeSignState={feeSignState}
            feeSignError={feeSignError}
            feePendingHash={feePendingHash}
            chainId={base.id}
            onSign={() => void handleSignFeeTransfer()}
            onRetryRecording={handleRetryFeeRecording}
          />
        )}
      </Panel>
    );
  }

  // Deliberately its own branch, not folded into TradeStatusView above: there is no
  // TradeTransactionDto yet (recording it is exactly what failed), only the raw hash the
  // wallet returned. No "Done"/dismiss action on purpose — a broadcast-but-unrecorded trade
  // shouldn't be casually walked away from; retrying is cheap and safe (idempotent on the
  // backend), so that's the only way forward from here.
  if (step === 'record-failed') {
    const explorerUrl = pendingHash ? explorerTxUrl(base.id, pendingHash) : null;
    return (
      <Panel title="Trade" onClose={onClose}>
        <div className="space-y-3 text-center">
          <p className="font-body text-sm font-semibold text-down">
            Your trade was sent to the network, but we couldn&apos;t record it.
          </p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
              View on Basescan
            </a>
          )}
          <Button type="button" onClick={handleRetryRecording} className="w-full">
            Retry
          </Button>
        </div>
      </Panel>
    );
  }

  // --- Review step -------------------------------------------------------------------------

  if (step === 'review' || step === 'approving' || step === 'signing') {
    if (!quote) return null;
    return (
      <Panel title="Review trade" onClose={onClose} onBack={step === 'review' ? () => setStep('form') : undefined}>
        <QuoteSummary quote={quote} />
        {isExpired && (
          <div className="rounded-lg bg-down/10 px-3 py-2 font-body text-xs text-down">
            This quote expired. <button type="button" className="underline" onClick={() => { setRefreshTick((n) => n + 1); setStep('form'); }}>Refresh it</button> before continuing.
          </div>
        )}
        {flowError && <p className="font-body text-xs text-down">{flowError}</p>}
        {quote.priceImpactLevel === 'extreme' && (
          <label className="flex items-start gap-2 rounded-lg bg-down/10 px-2.5 py-2 font-body text-xs text-down">
            <input
              type="checkbox"
              checked={priceImpactAcknowledged}
              onChange={(e) => setPriceImpactAcknowledged(e.target.checked)}
              className="mt-0.5"
            />
            <span>I understand this trade has an extreme price impact and want to proceed anyway.</span>
          </label>
        )}
        {quote.requiresApproval && !approved && (
          <Button type="button" onClick={() => void handleApprove()} disabled={step === 'approving' || isExpired}>
            {step === 'approving' ? 'Approving…' : `1. Approve ${side === 'BUY' ? quote.quoteToken.symbol : quote.token.symbol}`}
          </Button>
        )}
        <Button
          type="button"
          onClick={() => void handleConfirmAndSign()}
          disabled={
            isExpired ||
            step === 'signing' ||
            (quote.requiresApproval && !approved) ||
            (quote.priceImpactLevel === 'extreme' && !priceImpactAcknowledged)
          }
        >
          {step === 'signing' ? 'Confirm in your wallet…' : quote.requiresApproval ? '2. Confirm & sign' : 'Confirm & sign'}
        </Button>
      </Panel>
    );
  }

  // --- Form step ---------------------------------------------------------------------------

  return (
    <Panel title="Trade" onClose={onClose}>
      <div className="flex rounded-lg bg-surface-raised p-1">
        {(['BUY', 'SELL'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setSide(option);
              setAmount('');
            }}
            className={cn(
              'flex-1 rounded-md py-1.5 font-body text-sm font-semibold transition-colors',
              side === option ? (option === 'BUY' ? 'bg-up text-white' : 'bg-down text-white') : 'text-ink-600',
            )}
          >
            {option === 'BUY' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>

      <AmountInput
        value={amount}
        onChange={setAmount}
        inputTokenAddress={inputTokenAddress}
        inputTokenSymbol={inputTokenSymbol}
        inputTokenDecimals={inputTokenDecimals}
      />

      <SlippageControl valueBps={slippageBps} onChange={setSlippageBps} />

      {quoteStatus === 'error' && <p className="font-body text-xs text-down">{quoteError}</p>}

      {quoteStatus === 'ready' && quote && <QuoteSummary quote={quote} />}

      <Button type="button" disabled={quoteStatus !== 'ready' || !quote} onClick={() => setStep('review')} className="w-full">
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

function TradeStatusView({
  step,
  transaction,
  chainId,
  onDone,
}: {
  step: Extract<Step, 'submitted' | 'pending' | 'confirmed' | 'failed'>;
  transaction: TradeTransactionDto | null;
  chainId: number;
  onDone: () => void;
}) {
  const explorerUrl = transaction ? explorerTxUrl(chainId, transaction.txHash) : null;

  return (
    <div className="space-y-3 text-center">
      {step === 'submitted' && <p className="font-body text-sm text-ink-600">Transaction submitted — waiting for it to be picked up…</p>}
      {step === 'pending' && <p className="font-body text-sm text-ink-600">Waiting for confirmation on-chain…</p>}
      {step === 'confirmed' && <p className="font-body text-sm font-semibold text-up">Trade confirmed ✓</p>}
      {step === 'failed' && (
        <p className="font-body text-sm font-semibold text-down">
          {transaction?.status === 'EXPIRED' ? 'No confirmation was received in time.' : 'This trade failed on-chain.'}
        </p>
      )}
      {transaction?.failureReason && <p className="font-body text-xs text-ink-600">{transaction.failureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View on Basescan
        </a>
      )}
      {(step === 'confirmed' || step === 'failed') && (
        <Button type="button" variant="secondary" onClick={onDone} className="w-full">
          Done
        </Button>
      )}
    </div>
  );
}

/**
 * The separate guaranteed-USDC fee transfer's own status and controls — see
 * docs/TRADING.md#guaranteed-usdc-fees. Rendered alongside (never inside) TradeStatusView:
 * the swap above it is the authoritative "did my trade happen," this is purely about
 * whether Kamby has collected its fee yet, which never blocks or reverses the trade
 * itself.
 */
function FeeTransferSection({
  transaction,
  feeSignState,
  feeSignError,
  feePendingHash,
  chainId,
  onSign,
  onRetryRecording,
}: {
  transaction: TradeTransactionDto;
  feeSignState: 'idle' | 'signing' | 'record-failed';
  feeSignError: string | null;
  feePendingHash: string | null;
  chainId: number;
  onSign: () => void;
  onRetryRecording: () => void;
}) {
  if (feeSignState === 'record-failed') {
    const explorerUrl = feePendingHash ? explorerTxUrl(chainId, feePendingHash) : null;
    return (
      <div className="space-y-2 rounded-lg bg-surface-raised p-3 text-center">
        <p className="font-body text-xs font-semibold text-down">The platform fee was sent, but we couldn&apos;t record it.</p>
        {feeSignError && <p className="font-body text-xs text-ink-600">{feeSignError}</p>}
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
            View on Basescan
          </a>
        )}
        <Button type="button" variant="secondary" onClick={onRetryRecording} className="w-full">
          Retry
        </Button>
      </div>
    );
  }

  if (!transaction.feeTxHash) {
    return (
      <div className="space-y-2 rounded-lg bg-surface-raised p-3 text-center">
        <p className="font-body text-xs text-ink-600">Kamby&apos;s fee hasn&apos;t been sent yet — a separate signature.</p>
        {feeSignError && <p className="font-body text-xs text-down">{feeSignError}</p>}
        <Button type="button" variant="secondary" onClick={onSign} disabled={feeSignState === 'signing'} className="w-full">
          {feeSignState === 'signing' ? 'Confirm in your wallet…' : 'Send platform fee'}
        </Button>
      </div>
    );
  }

  const explorerUrl = explorerTxUrl(chainId, transaction.feeTxHash);
  return (
    <div className="space-y-1 rounded-lg bg-surface-raised p-3 text-center">
      {transaction.feeStatus === 'PENDING' && <p className="font-body text-xs text-ink-600">Platform fee sent — waiting for confirmation…</p>}
      {transaction.feeStatus === 'CONFIRMED' && <p className="font-body text-xs font-semibold text-up">Platform fee confirmed ✓</p>}
      {(transaction.feeStatus === 'FAILED' || transaction.feeStatus === 'EXPIRED') && (
        <p className="font-body text-xs font-semibold text-down">
          {transaction.feeStatus === 'EXPIRED' ? 'The fee transfer never confirmed in time.' : 'The fee transfer failed on-chain.'}
        </p>
      )}
      {transaction.feeFailureReason && <p className="font-body text-xs text-ink-600">{transaction.feeFailureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View fee transfer on Basescan
        </a>
      )}
    </div>
  );
}

function explorerTxUrl(chainId: number, txHash: string): string | null {
  if (chainId === base.id) return `https://basescan.org/tx/${txHash}`;
  return null;
}
