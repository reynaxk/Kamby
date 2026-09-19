'use client';

import { useEffect, useRef, useState } from 'react';
import { useSignTypedData } from '@privy-io/react-auth';
import { Button, cn } from '@kamby/ui';
import { CHAIN_REGISTRY, isQuoteExpired, slugForChainId, TRADING_DEFAULTS, type TradeQuoteDto, type TradeSide, type TradeTransactionDto } from '@kamby/domain';
import { ArrowLeft, CheckCircle2, X, XCircle } from 'lucide-react';
import { erc20Abi } from 'viem';
import { useAccount } from 'wagmi';
import { sendTransaction, writeContract } from 'wagmi/actions';
import { useWalletVerification } from '@/hooks/useWalletVerification';
import { wagmiConfig } from '@/lib/wagmi-config';
import { explorerName, explorerTxUrl } from '@/lib/explorer';
import { getQuote, getTransaction, relaySwap, submitFeeTransaction, submitTransaction } from '@/lib/trading-client';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { AmountInput } from './AmountInput';
import { GaslessToggle } from './GaslessToggle';
import { SlippageControl } from './SlippageControl';
import { QuoteSummary } from './QuoteSummary';

export interface TradePanelProps {
  /** The real chain this specific token trades on — see lib/explorer.ts and
   *  ConnectWalletButton's own `expectedChainId` doc comment. Required, not defaulted to
   *  Base: added 2026-09-16 for BNB Chain going live, deliberately forcing every call site
   *  to be reviewed rather than silently inheriting a wrong Base assumption once real BNB
   *  tokens exist. */
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  quoteTokenAddress: string;
  quoteTokenSymbol: string | null;
  quoteTokenDecimals: number;
  initialSide?: TradeSide;
  onClose?: () => void;
  /** Fires whenever the panel's internal step changes — added for the visual overhaul so a
   *  parent (KambyTerminal) can show real, state-driven emphasis (a glow on its wrapping
   *  card) only while an order is genuinely in flight, never as idle decoration. Optional
   *  and side-effect-free to omit; every existing call site behaves exactly as before. */
  onStepChange?: (step: TradePanelStep) => void;
}

export type TradePanelStep =
  | 'form'
  | 'review'
  | 'approving'
  | 'signing'
  | 'submitted'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'record-failed';
type Step = TradePanelStep;

function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err && typeof (err as { shortMessage?: unknown }).shortMessage === 'string') {
    return (err as { shortMessage: string }).shortMessage;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong — please try again.';
}

/**
 * A 20% buffer on top of the quote provider's own gas estimate — real incident, 2026-09-16:
 * two embedded-wallet BUY attempts both reverted on-chain after consuming ~98% of the
 * *unbuffered* quoted gas limit (406,757/415,912 and 282,474/287,581 gas — confirmed via the
 * real transaction receipts), the signature of running out of gas mid-route on a multi-hop
 * aggregator swap, not genuine slippage. The same wallet's earlier trade via Trust Wallet
 * (an external extension) succeeded the same night — extension wallets commonly apply their
 * own gas-limit safety margin before broadcasting, independent of what a dApp requests;
 * Privy's embedded signer does not, and sends the quote's raw `gas` value exactly as given.
 * `null`/`undefined` (no quoted gas at all) stays `undefined`, letting wagmi fall back to its
 * own `eth_estimateGas` call, unaffected by this fix.
 */
/** 50%, raised from 20% on 2026-09-17 — a real BNB Chain BUY reverted at 98% of its gas
 *  limit (316,166 / 322,597 used) despite the 20% buffer, confirmed via an unconstrained
 *  `eth_call` replay of the exact same transaction at the prior block: it succeeded with no
 *  gas ceiling, proving the trade logic and on-chain state were both fine — this was purely
 *  underfunded gas, the same failure shape as the 2026-09-16 Base incident this buffer was
 *  built for, just needing more headroom on this chain/route. A generous limit costs nothing
 *  real: EVM only charges for gas actually consumed, never the limit itself, so over-buffering
 *  has no downside beyond the wallet needing enough native-token balance to cover the
 *  worst-case ceiling. */
function withGasBuffer(gas: string | null | undefined): bigint | undefined {
  if (!gas) return undefined;
  return (BigInt(gas) * 150n) / 100n;
}

/**
 * Standard "infinite approval" pattern, added 2026-09-16 — approving exactly
 * `quote.inputAmount` (the previous behavior) meant every single trade re-approved from
 * scratch, since the allowance was always fully consumed by the trade it was set for. That
 * compounded the wallet-interaction friction the user complained about the same night (see
 * lib/privy-config.ts's `showWalletUIs` doc comment for the other half of that fix).
 * Approving the max uint256 once means every later trade of the *same* input token skips
 * the approve step entirely — the same pattern virtually every major DEX/aggregator uses.
 * Real tradeoff, not free: the router contract (`quote.approvalSpender`) keeps standing
 * permission to pull up to this amount, not just one trade's worth, for as long as the
 * approval stands — accepted here as the standard, well-understood cost of that speedup.
 */
const MAX_UINT256 = 2n ** 256n - 1n;

/**
 * The one shared trade flow every entry point (token page, activity "Trade" action) opens
 * — see docs/TRADING.md#trading-ui. Review → Confirm & sign → wallet popup → submitted →
 * pending → confirmed/failed, never skipping a step and never showing a false success.
 * This component never signs anything itself: `sendTransaction`/`writeContract` below hand
 * the unsigned transaction to whatever wallet wagmi has connected — the wallet is the only
 * thing that ever touches a private key. See docs/WALLET_SECURITY.md.
 */
export function TradePanel({
  chainId,
  tokenAddress,
  tokenSymbol,
  tokenDecimals,
  quoteTokenAddress,
  quoteTokenSymbol,
  quoteTokenDecimals,
  initialSide = 'BUY',
  onClose,
  onStepChange,
}: TradePanelProps) {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const walletVerification = useWalletVerification();
  const { signTypedData } = useSignTypedData();
  const chainSlug = slugForChainId(chainId);
  const chainName = chainSlug ? CHAIN_REGISTRY[chainSlug].name : 'the right chain';

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(TRADING_DEFAULTS.defaultSlippageBps);
  // Opt-in gas sponsorship — see docs/GAS_RELAYER_PLAN.md's EVM section. Whether a given
  // quote actually ends up sponsored is never decided by this flag alone: it only *asks*;
  // `quote.consentTypedData` (present only when the backend confirms both "requested" AND
  // "eligible") is the single source of truth every later branch below reads instead.
  const [gasless, setGasless] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);

  const [quote, setQuote] = useState<TradeQuoteDto | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [step, setStep] = useState<Step>('form');
  useEffect(() => {
    onStepChange?.(step);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
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

  const onCorrectChain = walletChainId === chainId;
  const canQuote = isConnected && onCorrectChain && walletVerification.status === 'verified';

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
      getQuote({ chainId, side, tokenAddress, walletAddress: address, amount, slippageBps, sponsorshipRequested: gasless })
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
  }, [canQuote, side, amount, slippageBps, address, tokenAddress, chainId, refreshTick, gasless]);

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
    }, 1500); // was 4000 — Base's own block time is ~2s, so the longer interval meant the UI
    // could lag a real on-chain confirmation by up to several extra perceived seconds.
  }

  /**
   * No longer waits for the approve transaction's own confirmation before moving on — real
   * speedup, 2026-09-16, the other half of the "final fraction of a second" ask (see
   * withGasBuffer's and the polling-interval doc comments for the rest of that night's
   * work). Nonce ordering already guarantees the chain executes this wallet's approve
   * before its swap regardless of how quickly they're submitted back to back — the same
   * sender, sequential nonces, one block producer. Chains straight into
   * `handleConfirmAndSign()` the moment the approve is *broadcast* (not confirmed), so a
   * user only ever takes one action for an approve-then-swap trade instead of two. Real
   * tradeoff, accepted deliberately: if the approve itself somehow reverts, the swap signed
   * right after it will fail too (its expected allowance was never actually set) — a wasted
   * bit of gas on a doomed transaction, versus the previous guarantee that the swap was
   * never even attempted until the approve was proven to succeed. The manual "2. Confirm &
   * sign" button below still exists as the fallback: if this auto-chained attempt fails for
   * any reason, `handleConfirmAndSign`'s own catch returns to the `review` step with
   * `approved` already `true`, so a retry never needs a second approval.
   */
  async function handleApprove() {
    if (!quote?.approvalSpender) return;
    setFlowError(null);
    setStep('approving');
    try {
      await writeContract(wagmiConfig, {
        address: inputTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [quote.approvalSpender as `0x${string}`, MAX_UINT256],
      });
      setApproved(true);
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('review');
      return;
    }
    await handleConfirmAndSign();
  }

  async function handleConfirmAndSign() {
    if (!quote || !address) return;
    if (isQuoteExpired(new Date(quote.expiresAt))) {
      setFlowError('This quote just expired — refresh it before signing.');
      return;
    }
    setFlowError(null);
    setStep('signing');

    // Gasless branch — see handleConfirmAndRelay's own doc comment. quote.consentTypedData
    // (never a client-side guess) is the single source of truth for whether *this specific
    // quote* is sponsored; approving a token (if quote.requiresApproval) still happens
    // through the unchanged self-paid handleApprove above regardless — sponsorship never
    // covers that leg, see GaslessToggle's own doc comment.
    if (quote.consentTypedData) {
      await handleConfirmAndRelay(quote, address);
      return;
    }

    let hash: `0x${string}`;
    try {
      hash = await sendTransaction(wagmiConfig, {
        to: quote.unsignedTx.to as `0x${string}`,
        data: quote.unsignedTx.data as `0x${string}`,
        value: BigInt(quote.unsignedTx.value),
        gas: withGasBuffer(quote.unsignedTx.gas),
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

  /**
   * The gasless counterpart to handleConfirmAndSign's self-paid branch — see
   * docs/GAS_RELAYER_PLAN.md's EVM section. Signs the EIP-712 consent object the quote
   * response already carried (`quote.consentTypedData`, never constructed client-side —
   * the server rebuilds and verifies the identical object from its own persisted quote row,
   * see `EvmGasRelayerQuoteService#relay`'s own doc comment), then POSTs it to
   * `/trade/relay`, which broadcasts server-side. There is no already-broadcast hash to
   * fall back to displaying on a failure here (the relayer, not this client, broadcasts)
   * and so no separate record-failed retry state either — a plain retry from the review
   * step is always safe regardless of whether the original attempt's own broadcast landed,
   * since `/trade/relay` is idempotent on `quoteId`.
   *
   * `consentTypedData`'s uint256 fields (`value`/`chainId`/`expiry`) arrive from the API as
   * decimal strings — see `RelayedSwapTypedDataWire`'s own doc comment (`@kamby/domain`)
   * for why (`bigint` cannot survive `JSON.stringify`) — and must be converted back to real
   * `bigint`s before Privy's typed-data signer will accept them; the `types` array is
   * likewise spread into a fresh, mutable array, since the API's own value is `readonly`
   * (matching the same shape the server itself hashes against) but Privy's own type expects
   * a plain mutable array.
   */
  async function handleConfirmAndRelay(currentQuote: TradeQuoteDto, walletAddress: string) {
    const consent = currentQuote.consentTypedData;
    if (!consent) return; // unreachable — only ever called once this is already known non-null
    try {
      const { signature } = await signTypedData(
        {
          domain: consent.domain,
          types: { RelayedSwap: [...consent.types.RelayedSwap] },
          primaryType: consent.primaryType,
          message: {
            ...consent.message,
            value: BigInt(consent.message.value),
            chainId: BigInt(consent.message.chainId),
            expiry: BigInt(consent.message.expiry),
          },
        },
        { address: walletAddress },
      );
      setStep('submitted');
      const recorded = await relaySwap({ quoteId: currentQuote.id, walletAddress, signature });
      setTransaction(recorded);
      setStep('pending');
      pollTransactionStatus(recorded.id);
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('review');
    }
  }

  /** Records an already-broadcast transaction with the backend — split out from
   *  handleConfirmAndSign so a retry (from the record-failed step) can call this directly
   *  with the same hash, never re-signing or re-broadcasting. Safe to call more than once:
   *  submission is idempotent on (quoteId, txHash) — see
   *  docs/TRADING.md#transaction-submission.
   *
   *  Real 1-click, added alongside approve→swap's own auto-chain: once the swap is
   *  successfully recorded, immediately request the guaranteed-USDC fee signature too
   *  (see docs/TRADING.md#guaranteed-usdc-fees) rather than waiting for a second explicit
   *  click — this reverses the previous "never auto-fire, so a second popup never
   *  surprises the user" choice, replaced by the upfront disclosure in the review step
   *  below. On failure, `handleSignFeeTransfer` already falls back to exactly today's
   *  manual "Send platform fee" button (`FeeTransferSection`), so the swap's own success
   *  is never affected. Naturally covers the retry path too (`handleRetryRecording`),
   *  since the trigger lives inside this function's own success branch either way — no
   *  extra flag needed to avoid double-firing (a fee transfer can only ever reach this
   *  point once, right after the *first* successful recording). */
  async function recordSubmittedTransaction(hash: string, quoteId: string, walletAddress: string) {
    try {
      const recorded = await submitTransaction({ quoteId, walletAddress, txHash: hash });
      setTransaction(recorded);
      setPendingHash(null);
      setStep('pending');
      pollTransactionStatus(recorded.id);
      if (quote?.feeUnsignedTx) {
        await handleSignFeeTransfer(recorded);
      }
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
   *  docs/TRADING.md#guaranteed-usdc-fees. Takes the transaction explicitly rather than
   *  reading the `transaction` state variable: this is auto-fired from
   *  `recordSubmittedTransaction` the instant a trade is recorded, in the same tick
   *  `setTransaction` is called — React state hasn't flushed yet at that point, so a
   *  closure read of `transaction` would still see the *previous* (likely `null`) value.
   *  The manual "Send platform fee" button (`FeeTransferSection`, only ever rendered once
   *  `transaction` state is genuinely non-null) passes the same state value explicitly too,
   *  so there's exactly one code path, not two. */
  async function handleSignFeeTransfer(tx: TradeTransactionDto) {
    if (!quote?.feeUnsignedTx) return;
    setFeeSignError(null);
    setFeeSignState('signing');

    let hash: `0x${string}`;
    try {
      hash = await sendTransaction(wagmiConfig, {
        to: quote.feeUnsignedTx.to as `0x${string}`,
        data: quote.feeUnsignedTx.data as `0x${string}`,
        value: BigInt(quote.feeUnsignedTx.value),
        gas: withGasBuffer(quote.feeUnsignedTx.gas),
        maxFeePerGas: quote.feeUnsignedTx.maxFeePerGas ? BigInt(quote.feeUnsignedTx.maxFeePerGas) : undefined,
        maxPriorityFeePerGas: quote.feeUnsignedTx.maxPriorityFeePerGas ? BigInt(quote.feeUnsignedTx.maxPriorityFeePerGas) : undefined,
      });
    } catch (err) {
      // Nothing was broadcast — safe to let the user try signing the fee transfer again.
      setFeeSignError(friendlyError(err));
      setFeeSignState('idle');
      return;
    }

    await recordFeeTransaction(hash, tx.id);
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
        <ConnectWalletButton expectedChainId={chainId} />
      </Panel>
    );
  }

  if (!onCorrectChain) {
    return (
      <Panel title="Trade" onClose={onClose}>
        <p className="font-body text-sm text-ink-600">Your wallet is on the wrong network for this trade — it needs to be on {chainName}.</p>
        <ConnectWalletButton expectedChainId={chainId} />
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
        <TradeStatusView step={step} transaction={transaction} chainId={chainId} onDone={resetToForm} />
        {quote?.feeUnsignedTx && transaction && (
          <FeeTransferSection
            transaction={transaction}
            feeSignState={feeSignState}
            feeSignError={feeSignError}
            feePendingHash={feePendingHash}
            chainId={chainId}
            onSign={() => void handleSignFeeTransfer(transaction)}
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
    const explorerUrl = pendingHash ? explorerTxUrl(chainId, pendingHash) : null;
    return (
      <Panel title="Trade" onClose={onClose}>
        <div className="space-y-3 text-center">
          <p className="font-body text-sm font-semibold text-down">
            Your trade was sent to the network, but we couldn&apos;t record it.
          </p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
              View on {explorerName(chainId)}
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
        {quote.consentTypedData ? (
          <p className="rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-ink-600">
            {quote.requiresApproval
              ? 'This trade needs 1 quick wallet approval, then a free signature to confirm — Kamby pays the network fee.'
              : 'Gasless — Kamby pays the network fee for this trade. Just one free signature, no gas needed.'}
          </p>
        ) : (
          quote.feeUnsignedTx && (
            <p className="rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-ink-600">
              {quote.requiresApproval
                ? "This trade needs up to 3 quick wallet approvals — token approval (once), the swap, and Kamby's platform fee."
                : "This trade needs 2 quick wallet approvals — the swap, then Kamby's platform fee."}
            </p>
          )
        )}
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
              // bg-up text-black, not text-white — same pairing as Button's own `buy`
              // variant: Void's `up` is a bright neon green that white text can't sit on
              // readably (~1.3:1 contrast). `down` stays white — its Void value is bright
              // but saturated enough to still read at ~3.9:1.
              side === option ? (option === 'BUY' ? 'bg-up text-black' : 'bg-down text-white') : 'text-ink-600',
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

      {/* Rendered only once a real quote has confirmed sponsorship is actually available —
          see TradeQuoteDto.sponsorshipAvailable's own doc comment (@kamby/domain). Keeps
          this control invisible on a deployment where the relayer isn't configured yet
          (every production deployment today), rather than showing a toggle that would
          silently do nothing when switched on. */}
      {quote?.sponsorshipAvailable && <GaslessToggle value={gasless} onChange={setGasless} label="Gasless (no gas needed)" />}

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
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <h2 className="font-display text-base font-semibold text-ink-900">{title}</h2>
        </div>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-600 hover:text-ink-900">
            <X className="h-4 w-4" />
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
      {step === 'confirmed' && (
        <div className="flex items-center justify-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-up" />
          <p className="font-body text-sm font-semibold text-up">Trade confirmed</p>
        </div>
      )}
      {step === 'failed' && (
        <div className="flex items-center justify-center gap-2">
          <XCircle className="h-5 w-5 text-down" />
          <p className="font-body text-sm font-semibold text-down">
            {transaction?.status === 'EXPIRED' ? 'No confirmation was received in time.' : 'This trade failed on-chain.'}
          </p>
        </div>
      )}
      {transaction?.failureReason && <p className="font-body text-xs text-ink-600">{transaction.failureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View on {explorerName(chainId)}
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
            View on {explorerName(chainId)}
          </a>
        )}
        <Button type="button" variant="secondary" onClick={onRetryRecording} className="w-full">
          Retry
        </Button>
      </div>
    );
  }

  if (!transaction.feeTxHash) {
    // A sponsored trade's fee leg is broadcast by the relayer itself, reactively, once the
    // swap confirms — see EvmGasRelayerQuoteService#submitFeeLegIfDue's own doc comment.
    // There is nothing for this client to sign; showing the self-paid "Send platform fee"
    // button here would offer an action that does not apply to this trade at all.
    if (transaction.sponsoredByRelayer) {
      return (
        <div className="space-y-2 rounded-lg bg-surface-raised p-3 text-center">
          <p className="font-body text-xs text-ink-600">Kamby is sending the platform fee — no action needed.</p>
        </div>
      );
    }
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
      {transaction.feeStatus === 'CONFIRMED' && (
        <div className="flex items-center justify-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-up" />
          <p className="font-body text-xs font-semibold text-up">Platform fee confirmed</p>
        </div>
      )}
      {(transaction.feeStatus === 'FAILED' || transaction.feeStatus === 'EXPIRED') && (
        <p className="font-body text-xs font-semibold text-down">
          {transaction.feeStatus === 'EXPIRED' ? 'The fee transfer never confirmed in time.' : 'The fee transfer failed on-chain.'}
        </p>
      )}
      {transaction.feeFailureReason && <p className="font-body text-xs text-ink-600">{transaction.feeFailureReason}</p>}
      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noreferrer" className="block font-body text-xs text-accent underline">
          View fee transfer on {explorerName(chainId)}
        </a>
      )}
    </div>
  );
}
