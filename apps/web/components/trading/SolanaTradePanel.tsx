'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSignAndSendTransaction, useSignTransaction, useWallets, type ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';
import { Connection } from '@solana/web3.js';
import { Button, cn } from '@kamby/ui';
import { isQuoteExpired, TRADING_DEFAULTS, type SolanaTradeQuoteDto, type SolanaTradeTransactionDto, type TradeSide } from '@kamby/domain';
import bs58 from 'bs58';
import { ArrowLeft, CheckCircle2, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { useSolanaWalletVerification } from '@/hooks/useSolanaWalletVerification';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { RpcStatusBar } from '@/components/terminal/RpcStatusBar';
import { useTerminalToast } from '@/components/terminal/ToastProvider';
import {
  getSolanaQuote,
  getSolanaTransaction,
  getSponsoredSolanaQuote,
  submitSolanaTransaction,
  submitSponsoredSolanaTransaction,
} from '@/lib/solana-trading-client';
import { GaslessToggle } from './GaslessToggle';
import { JitoTipControl } from './JitoTipControl';
import { SlippageControl } from './SlippageControl';
import { clientEnv } from '@/lib/env';
import { SolAmountInput, SOL_PRESETS, solToRawLamports } from './SolAmountInput';
import { SolanaQuoteSummary } from './SolanaQuoteSummary';
import { UsdPresetAmountInput, USD_PRESETS, usdToRawUsdc } from './UsdPresetAmountInput';

export interface SolanaTradePanelProps {
  tokenMint: string;
  tokenSymbol: string | null;
  initialSide?: TradeSide;
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

/** The inverse of base64ToUint8Array — same "no Buffer in this bundle" reasoning. Needed to
 *  hand the gas relayer a partially-signed transaction: the sign-only Solana wallet API
 *  hands back raw bytes, but the backend's sponsored-submit endpoint expects base64 (same
 *  shape every other unsigned/signed transaction this app moves over HTTP already uses). */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

const SOL_DECIMALS = 9;
const USDC_DECIMALS = 6;

/** The confirmed-trade toast needs a real, correctly-scaled amount — unlike
 *  SolanaQuoteSummary's deliberate "N raw units" label elsewhere in this file's own review
 *  step (honest about not resolving an arbitrary SPL mint's decimals), a success toast has
 *  no room for that caveat and a bare 6-9-digit raw integer here would just look broken.
 *  BUY's output is always SOL (fixed, known decimals, unlike an arbitrary mint); SELL's
 *  output is always USDC — same "always one fixed leg" reasoning as toSocialActivity's own
 *  comment on the backend. */
function formatReceivedAmount(side: TradeSide, rawAmount: string): string {
  if (side === 'BUY') {
    return `${(Number(rawAmount) / 10 ** SOL_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`;
  }
  return `$${(Number(rawAmount) / 10 ** USDC_DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;
}

/**
 * Solana's counterpart to TradePanel.tsx — see that component's own doc comment for the
 * shared "never a false success" principle. Deliberately simpler than the EVM flow: no
 * ERC-20-style approval step (nothing to approve on Solana), and no separate guaranteed-
 * USDC-fee-transfer step (Jupiter's `platformFeeBps`/`feeAccount` deduct the platform fee
 * atomically inside the swap itself — see docs/TRADING.md#solana).
 *
 * Launch scope is non-custodial (see docs/WALLET_SECURITY.md's Solana section): the user's
 * own wallet always signs the entire transaction, always pays its own network fee, and this
 * component never has a backend co-signer/relayer to lean on. Two broadcast paths, chosen
 * by `jitoTipLamports` (see JitoTipControl and the two `signAndBroadcastVia*` helpers
 * below) — the default path signs *and sends* in one step via Privy's own hook
 * (`useSignAndSendTransaction`); opting into a Jito tip signs only (`useSignTransaction`),
 * then this component broadcasts the already-fully-signed bytes to Jito's own endpoint
 * itself, since that's the one thing that makes the tip (built into the transaction
 * server-side) actually matter. Either way, only the resulting signature is reported to
 * the backend afterward, to record.
 *
 * Rendered inside the `.kamby-void` scope (see app/solana/page.tsx and globals.css) —
 * every shared token (`bg-surface`, `text-accent`, `text-up`/`text-down`, ...) resolves to
 * the Void terminal palette there, so nothing in this file hardcodes a terminal color
 * directly except where BUY/SELL need to diverge from the single shared `accent` (a toggle
 * where both sides used the same highlight color would defeat the point of the color
 * coding), via the `up`/`down` tokens instead.
 */
export function SolanaTradePanel({ tokenMint, tokenSymbol, initialSide = 'BUY' }: SolanaTradePanelProps) {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const walletVerification = useSolanaWalletVerification();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const { signTransaction } = useSignTransaction();
  const toast = useTerminalToast();

  const [side, setSide] = useState<TradeSide>(initialSide);
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState<number>(TRADING_DEFAULTS.defaultSlippageBps);
  const [jitoTipLamports, setJitoTipLamports] = useState(0);
  const [gasless, setGasless] = useState(false);
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
  const activeToastIdRef = useRef<string | null>(null);

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
      // Gasless quotes come from a dedicated endpoint (a different fee payer baked into the
      // returned unsigned transaction, not just a broadcast-path choice like the Jito tip
      // below) — jitoTipLamports is simply not sent on this path, since the relayer's own
      // build never supports it (see SolanaController's own doc comment on the backend).
      const fetchQuote = gasless
        ? getSponsoredSolanaQuote({ side, tokenMint, walletAddress: wallet!.address, amount, slippageBps })
        : getSolanaQuote({ side, tokenMint, walletAddress: wallet!.address, amount, slippageBps, jitoTipLamports });
      fetchQuote
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
  }, [side, tokenMint, amount, slippageBps, jitoTipLamports, gasless, canQuote, refreshTick]);

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
          if (activeToastIdRef.current) {
            toast.update(activeToastIdRef.current, {
              variant: 'success',
              title: 'Trade confirmed',
              description: formatReceivedAmount(tx.side, tx.expectedOutputAmount),
              solscanUrl: `https://solscan.io/tx/${tx.signature}`,
            });
          }
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (tx.status === 'FAILED' || tx.status === 'EXPIRED') {
          setStep('failed');
          if (activeToastIdRef.current) {
            toast.update(activeToastIdRef.current, {
              variant: 'error',
              title: 'Trade failed',
              description: tx.failureReason ?? undefined,
              solscanUrl: `https://solscan.io/tx/${tx.signature}`,
            });
          }
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setStep('pending');
        }
      });
    }, 1500); // was 3000 — Solana confirms in well under a second, so the longer interval
    // meant the UI could lag a real confirmation by seconds of perceived wait.
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, transaction?.id]);

  const isExpired = quote !== null && isQuoteExpired(new Date(quote.expiresAt), new Date(now));

  /** The existing, unchanged path — Privy's own hook signs and broadcasts to the
   *  configured Solana RPC (`privyConfig.solana.rpcs`) in one step. */
  async function signAndBroadcastViaRpc(transactionBytes: Uint8Array, wallet: ConnectedStandardSolanaWallet): Promise<string> {
    const result = await signAndSendTransaction({ transaction: transactionBytes, wallet });
    return bs58.encode(result.signature);
  }

  /** Signs only (Privy never broadcasts here), then submits the fully-signed bytes
   *  directly to Jito's own endpoint (`NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL`, defaulting to
   *  the real, verified mainnet endpoint — see lib/env.ts) — a plain `sendTransaction`-
   *  proxy, so a plain `Connection` pointed at it behaves exactly like pointing one at any
   *  normal RPC. This is the one thing that actually makes the tip instruction (already
   *  built into the transaction server-side) matter. */
  async function signAndBroadcastViaJito(transactionBytes: Uint8Array, wallet: ConnectedStandardSolanaWallet): Promise<string> {
    const { signedTransaction } = await signTransaction({ transaction: transactionBytes, wallet });
    const jitoConnection = new Connection(clientEnv.NEXT_PUBLIC_JITO_BLOCK_ENGINE_URL);
    return jitoConnection.sendRawTransaction(signedTransaction);
  }

  /** The gas-relayer counterpart to the two broadcast paths above — signs only (reusing the
   *  same useSignTransaction hook the Jito path already uses, no second signing mechanism
   *  needed), but never broadcasts: the relayer still owes its own co-signature as fee
   *  payer, so this hands the partially-signed bytes to the backend instead of a
   *  Connection. See GasRelayerService#submitSponsoredTransaction's own doc comment. */
  async function signOnlyForSponsorship(transactionBytes: Uint8Array, wallet: ConnectedStandardSolanaWallet): Promise<string> {
    const { signedTransaction } = await signTransaction({ transaction: transactionBytes, wallet });
    return uint8ArrayToBase64(signedTransaction);
  }

  async function handleConfirmAndSign() {
    if (!quote || !wallet) return;
    setFlowError(null);
    setStep('signing');
    const toastId = toast.push({ variant: 'pending', title: 'Confirm in your wallet…', description: 'Waiting for your signature.' });
    activeToastIdRef.current = toastId;
    try {
      const transactionBytes = base64ToUint8Array(quote.unsignedTxBase64);
      if (gasless) {
        // No broadcast happens from this client at all here — the relayer still owes its
        // own co-signature as fee payer before anything goes on-chain, so there's no
        // signature to show yet, unlike the two self-paid paths below.
        const partiallySignedTxBase64 = await signOnlyForSponsorship(transactionBytes, wallet);
        await submitSponsoredTransactionAndRecord(partiallySignedTxBase64, quote.id, wallet.address, toastId);
        return;
      }
      // The tip *instruction* was already built into this transaction server-side (see
      // JupiterQuoteService's own doc comment) when jitoTipLamports > 0 — it only actually
      // does anything once the *signed* transaction is broadcast through Jito's own
      // endpoint instead of the normal RPC, which is the one thing this branch changes.
      // Either path: the user's own wallet signs the whole thing, exactly the same as
      // before this existed — nothing here changes custody.
      const signature =
        jitoTipLamports > 0 ? await signAndBroadcastViaJito(transactionBytes, wallet) : await signAndBroadcastViaRpc(transactionBytes, wallet);
      // A real, broadcast signature must never be discarded just because *recording* it
      // afterward fails — same reasoning as TradePanel's own pendingHash handling.
      setPendingSignature(signature);
      toast.update(toastId, {
        title: 'Trade submitted',
        description: 'Waiting for network confirmation…',
        solscanUrl: `https://solscan.io/tx/${signature}`,
      });
      await recordSubmittedTransaction(signature, quote.id, wallet.address, toastId);
    } catch (err) {
      setStep('review');
      setFlowError(friendlyError(err));
      toast.update(toastId, { variant: 'error', title: 'Trade failed', description: friendlyError(err) });
    }
  }

  /** The gasless counterpart to recordSubmittedTransaction — one call, not two. There's no
   *  already-broadcast signature to fall back to displaying on failure (the relayer, not
   *  this client, broadcasts) and so no separate record-failed retry state either: a plain
   *  retry from the review step is always safe regardless of whether the original attempt's
   *  broadcast actually landed, since submitSponsoredTransaction is idempotent on quoteId
   *  (see its own doc comment, apps/api) — it either returns the transaction that already
   *  landed or genuinely submits for the first time, never a double-broadcast. */
  async function submitSponsoredTransactionAndRecord(partiallySignedTxBase64: string, quoteId: string, walletAddress: string, toastId?: string) {
    try {
      const tx = await submitSponsoredSolanaTransaction({ quoteId, walletAddress, partiallySignedTxBase64 });
      setTransaction(tx);
      setStep('submitted');
      if (toastId) {
        toast.update(toastId, {
          title: 'Trade submitted',
          description: 'Waiting for network confirmation…',
          solscanUrl: `https://solscan.io/tx/${tx.signature}`,
        });
      }
    } catch (err) {
      setStep('review');
      setFlowError(friendlyError(err));
      if (toastId) {
        toast.update(toastId, { variant: 'error', title: 'Trade failed', description: friendlyError(err) });
      }
    }
  }

  async function recordSubmittedTransaction(signature: string, quoteId: string, walletAddress: string, toastId?: string) {
    try {
      const tx = await submitSolanaTransaction({ quoteId, walletAddress, signature });
      setTransaction(tx);
      setStep('submitted');
    } catch (err) {
      setStep('record-failed');
      setFlowError(friendlyError(err));
      if (toastId) {
        toast.update(toastId, {
          variant: 'error',
          title: "Sent, but couldn't record it",
          description: friendlyError(err),
          solscanUrl: `https://solscan.io/tx/${signature}`,
        });
      }
    }
  }

  function handleRetryRecording() {
    if (!pendingSignature || !quote || !wallet) return;
    setFlowError(null);
    void recordSubmittedTransaction(pendingSignature, quote.id, wallet.address, activeToastIdRef.current ?? undefined);
  }

  function resetToForm() {
    setStep('form');
    setQuote(null);
    setQuoteStatus('idle');
    setTransaction(null);
    setPendingSignature(null);
    setFlowError(null);
    setAmount('');
    activeToastIdRef.current = null;
  }

  /** Mobile speed dock — populates the amount and jumps straight to the review step so a
   *  one-thumb trader never scrolls past a chart to get there, but still lands on the same
   *  explicit review-then-sign flow as desktop; a real quote still has to come back and the
   *  user still has to tap "Confirm & sign" themselves — this is a shortcut to review, not
   *  a way to skip it. Presets are USD/USDC on BUY, SOL on SELL — same unit split as the
   *  main form's amount input, see SolAmountInput's own doc comment for why. */
  function handleQuickPreset(preset: number) {
    setAmount(side === 'BUY' ? usdToRawUsdc(preset) : solToRawLamports(preset));
  }

  // --- Gating states: connect -> verify ----------------------------------------------------

  if (!wallet) {
    return (
      <Panel title="Trade">
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
      <Panel title="Trade">
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
      <Panel title="Trade">
        <SolanaTradeStatusView step={step} transaction={transaction} signature={pendingSignature} onDone={resetToForm} />
      </Panel>
    );
  }

  if (step === 'record-failed') {
    return (
      <Panel title="Trade">
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
      <Panel title="Review trade" onBack={step === 'review' ? () => setStep('form') : undefined}>
        <SolanaQuoteSummary quote={quote} />
        {gasless && (
          <p className="rounded-lg bg-surface-raised px-3 py-2 font-body text-xs text-ink-600">
            Gasless — Kamby pays the Solana network fee for this trade. One signature, no SOL needed.
          </p>
        )}
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
        <Button
          type="button"
          variant={side === 'BUY' ? 'buy' : 'sell'}
          className="w-full text-base font-bold uppercase tracking-wide"
          disabled={isExpired || step === 'signing'}
          onClick={() => void handleConfirmAndSign()}
        >
          {step === 'signing' ? 'Confirm in your wallet…' : `Confirm & ${side === 'BUY' ? 'buy' : 'sell'}`}
        </Button>
      </Panel>
    );
  }

  // --- Form step -----------------------------------------------------------------------------

  return (
    <>
      <Panel title="Trade" headerRight={<RpcStatusBar />}>
        <div className="flex gap-1.5">
          {(['BUY', 'SELL'] as const).map((s) => {
            const isActive = side === s;
            const Icon = s === 'BUY' ? TrendingUp : TrendingDown;
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  // BUY's amount is raw USDC (6 decimals); SELL's is raw SOL (9 decimals,
                  // see SolAmountInput's own doc comment) — a stale value from the other
                  // side would get silently reinterpreted in the wrong unit otherwise.
                  setSide(s);
                  setAmount('');
                }}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 font-display text-xs font-bold uppercase tracking-wide transition-colors',
                  isActive
                    ? s === 'BUY'
                      ? 'bg-up text-black'
                      : 'bg-down text-white'
                    : 'bg-surface-raised text-ink-600 hover:text-ink-900',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {s === 'BUY' ? `Buy ${tokenSymbol ?? 'token'}` : `Sell ${tokenSymbol ?? 'token'}`}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-raised px-3 py-2 font-body text-xs text-ink-600">
          <span className="truncate">
            Your wallet:{' '}
            <span className="font-mono text-ink-900">
              {wallet.address.slice(0, 4)}…{wallet.address.slice(-4)}
            </span>
            {' — send USDC (Solana network) here to trade.'}
          </span>
          <CopyAddressButton address={wallet.address} />
        </div>
        {side === 'BUY' ? (
          <UsdPresetAmountInput value={amount} onChange={setAmount} walletAddress={wallet.address} />
        ) : (
          <SolAmountInput value={amount} onChange={setAmount} walletAddress={wallet.address} />
        )}
        <SlippageControl valueBps={slippageBps} onChange={setSlippageBps} />
        <GaslessToggle value={gasless} onChange={setGasless} label="Gasless (no SOL needed)" />
        {/* A sponsored transaction always broadcasts via the relayer's own RPC call, never
            through Jito — showing this control while gasless is on would offer a choice
            that silently does nothing, see GaslessToggle's own doc comment. */}
        {!gasless && <JitoTipControl valueLamports={jitoTipLamports} onChange={setJitoTipLamports} />}
        {quoteStatus === 'ready' && quote && <SolanaQuoteSummary quote={quote} compact />}
        {quoteStatus === 'error' && quoteError && <p className="font-body text-xs text-down">{quoteError}</p>}
        <Button
          type="button"
          variant={side === 'BUY' ? 'buy' : 'sell'}
          className="w-full text-base font-bold uppercase tracking-wide"
          disabled={quoteStatus !== 'ready' || !quote}
          onClick={() => setStep('review')}
        >
          {quoteStatus === 'loading' ? 'Getting quote…' : `Review ${side === 'BUY' ? 'buy' : 'sell'}`}
        </Button>
      </Panel>

      {/* Mobile speed dock — see handleQuickPreset's own doc comment on why this still
          lands on the review step rather than executing directly. `pb-[env(safe-area-inset-bottom)]`
          keeps it clear of a phone's home-bar gesture area. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur md:hidden">
        <div className="flex gap-1.5">
          {(side === 'BUY' ? USD_PRESETS : SOL_PRESETS).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleQuickPreset(preset)}
              className="flex-1 rounded-full border border-line bg-surface-raised px-2 py-1.5 font-mono text-xs font-semibold text-ink-600 active:border-accent/60"
            >
              {side === 'BUY' ? `$${preset}` : preset}
            </button>
          ))}
        </div>
        <Button
          type="button"
          variant={side === 'BUY' ? 'buy' : 'sell'}
          className="mt-1.5 w-full text-sm font-bold uppercase tracking-wide"
          disabled={quoteStatus !== 'ready' || !quote}
          onClick={() => setStep('review')}
        >
          {quoteStatus === 'loading' ? 'Getting quote…' : `Instant ${side === 'BUY' ? 'buy' : 'sell'}`}
        </Button>
      </div>
      {/* Keeps the dock from covering the bottom of the form on mobile. */}
      <div className="h-24 md:hidden" aria-hidden />
    </>
  );
}

function Panel({
  title,
  onBack,
  headerRight,
  children,
}: {
  title: string;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
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
        {headerRight}
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
  const Icon = step === 'confirmed' ? CheckCircle2 : step === 'failed' ? XCircle : null;

  return (
    <div className="space-y-3 text-center">
      <div className="flex items-center justify-center gap-2">
        {Icon && <Icon className={cn('h-5 w-5', color)} />}
        <p className={cn('font-body text-sm font-semibold', color)}>{label}</p>
      </div>
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
