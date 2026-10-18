'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChainBadge, type BadgeChain } from '@/components/market/ChainBadge';
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
import { ensureSolanaWalletFunded } from '@/lib/solana-trading-client';

/** Smallest USDC withdrawal in dollars, unless it empties the balance. */
const MIN_USDC_WITHDRAWAL = 10n;
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
  SOLANA_MIN_FEE_LAMPORTS,
  type SendAsset,
  type SendChainOption,
} from '@/lib/send';
import { friendlyError } from '@/lib/friendly-error';
import { Check, Send } from 'lucide-react';
import { TradeModal } from '../trading/TradeModal';
import { ModalHeader, WithdrawGlyph } from './ModalHeader';
import { authedFetch } from '@/lib/session-client';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { MoveNote } from '../trading/CrossChainMove';
import { useCrossChainFunding } from '@/lib/use-cross-chain-funding';
import type { BridgeChain } from '@/lib/bridge-client';
import { ConnectWalletButton } from './ConnectWalletButton';
import { NetworkPicker } from './NetworkPicker';
import { useTranslations } from 'next-intl';

type Step = 'form' | 'review' | 'signing' | 'confirmed' | 'failed';


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

/** The connected wallet's native SOL balance — fetched independent of which asset is
 *  selected, since the network fee (and possibly the destination's ATA rent) is always
 *  paid in SOL regardless of whether a native or SPL-token transfer is being sent. Powers
 *  the "this wallet has no SOL to pay the fee" check below; a wallet that legitimately
 *  holds only USDC and zero SOL needs to know that *before* hitting a cryptic RPC preflight
 *  rejection, not after. */
function useSolanaNativeBalance(solanaAddress: string | undefined): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => {
    setBalance(null);
    if (!solanaAddress || !solanaConnection) return;
    let cancelled = false;
    solanaConnection
      .getBalance(new PublicKey(solanaAddress), 'confirmed')
      .then((lamports) => {
        if (!cancelled) setBalance(BigInt(lamports));
      })
      .catch(() => {
        if (!cancelled) setBalance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [solanaAddress]);

  return balance;
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
export interface SendRecipient {
  username: string;
  avatarUrl: string | null;
  evmAddress: string | null;
  solanaAddress: string | null;
}

/** Kamby users can send each other USDC by name; the smallest such send. */
const MIN_USER_SEND_USD = 1;

/**
 * Withdraw to any address, or — `toUser` (2026-10-15, owner: "send to other users by typing their
 * username") — send to another Kamby user by @name: the API resolves their verified wallet for the
 * chosen network, the review shows who they are before anything is signed.
 */
export function SendModal({
  open,
  onClose,
  toUser = false,
  presetUsername,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  toUser?: boolean;
  /** Send to this @name, fixed (a private chat's Send USDC, 2026-10-17). */
  presetUsername?: string;
  /** Called with the transfer once it's confirmed — replaces the default recipient notice
   *  (the chat posts the transfer as a message, which notifies them itself). */
  onSent?: (txRef: string, chainSlug: string) => void;
}) {
  const tL = useTranslations('labels');
  const tU = useTranslations('ui');
  const tW = useTranslations('wallet');
  const tAuth = useTranslations('auth');
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
  const [username, setUsername] = useState(presetUsername ?? '');
  const [recipient, setRecipient] = useState<SendRecipient | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
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
  // Always USDC now (one balance), so a network change keeps the typed amount.
  useEffect(() => {
    if (assets[0]) setAsset(assets[0]);
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
  const solanaNativeBalance = useSolanaNativeBalance(chain.kind === 'solana' ? solanaWallet?.address : undefined);
  const solanaFeeInsufficient =
    // Token sends get their SOL from Kamby right before sending (ensureSolanaWalletFunded,
    // 2026-10-07), so only a native SOL send needs SOL already in the wallet.
    chain.kind === 'solana' && asset.kind === 'native' && solanaNativeBalance !== null && solanaNativeBalance < SOLANA_MIN_FEE_LAMPORTS;

  const amountRaw = useMemo(() => {
    if (!amountDisplay || tokenDecimals === null) return null;
    try {
      return parseUnits(amountDisplay, tokenDecimals);
    } catch {
      return null;
    }
  }, [amountDisplay, tokenDecimals]);

  // @name → their wallet on this network (looked up as they type).
  useEffect(() => {
    if (!toUser) return;
    const name = username.trim().replace(/^@/, '').toLowerCase();
    setRecipient(null);
    setRecipientError(null);
    if (name.length < 3) return;
    setLookingUp(true);
    const timer = setTimeout(() => {
      authedFetch(`/identity/users/${encodeURIComponent(name)}/recipient`)
        .then(async (res) => {
          if (res.ok) return setRecipient((await res.json()) as SendRecipient);
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          setRecipientError(body?.message ?? tL('noSuchUser'));
        })
        .catch(() => setRecipientError(tL('noSuchUser')))
        .finally(() => setLookingUp(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [toUser, username, tL]);
  useEffect(() => {
    if (!toUser) return;
    setDestination((chain.kind === 'evm' ? recipient?.evmAddress : recipient?.solanaAddress) ?? '');
  }, [toUser, recipient, chain.kind]);

  const destinationValid = destination.trim().length > 0 && isValidDestination(chain.kind, destination);
  // USDC withdrawals: at least $10, or the whole balance when it's less (owner rule 2026-10-07 —
  // every withdrawal's gas is Kamby's cost, and small balances must never be stuck).
  const isUsdc = asset.kind === 'token'; // USDC (USDG on Robinhood) — the only thing Kamby users hold
  const minimumUsd = toUser ? MIN_USER_SEND_USD : Number(MIN_USDC_WITHDRAWAL);
  // One USDC (2026-10-13): withdrawing more than this network holds moves the rest over first.
  const amountUsd = amountRaw !== null && tokenDecimals !== null ? Number(formatUnits(amountRaw, tokenDecimals)) : null;
  const funding = useCrossChainFunding(chain.slug as BridgeChain, isUsdc ? amountUsd : null);
  // One USDC balance (owner, 2026-10-18): shown as the total everywhere; what one send can reach
  // is this network's USDC plus the biggest other balance (a single move), less a few cents.
  const otherBest = Math.max(0, ...(['base', 'bnb', 'robinhood', 'solana'] as const).filter((c) => c !== chain.slug).map((c) => (funding.balances[c] ?? 0) - 0.1));
  const spendableUsd = (funding.balances[chain.slug as BridgeChain] ?? 0) + otherBest;
  const atMax = amountUsd !== null && amountUsd >= Math.floor(spendableUsd * 100) / 100 - 0.005;
  const belowMinimum =
    isUsdc && amountRaw !== null && tokenDecimals !== null && amountRaw < BigInt(minimumUsd) * 10n ** BigInt(tokenDecimals) && amountRaw !== balance && !atMax;
  const shortOnChain = balance !== null && amountRaw !== null && amountRaw > balance;
  const needsMove = isUsdc && shortOnChain && funding.canCover && funding.stage !== 'done';
  const amountValid = amountRaw !== null && amountRaw > 0n && (balance === null || amountRaw <= balance || needsMove) && !belowMinimum;
  const canReview = destinationValid && amountValid && tokenDecimals !== null && !solanaFeeInsufficient;

  // Send to @name: no network to pick — the one you hold the most USDC on (that they can receive on).
  const autoPickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!toUser || !recipient || funding.balances.total === null || autoPickedFor.current === recipient.username) return;
    const options = SEND_CHAINS.filter((c) => (c.kind === 'evm' ? recipient.evmAddress : recipient.solanaAddress));
    const best = [...options].sort((a, b) => (funding.balances[b.slug as BridgeChain] ?? 0) - (funding.balances[a.slug as BridgeChain] ?? 0))[0];
    autoPickedFor.current = recipient.username;
    if (best && best.slug !== chain.slug) setChain(best);
  }, [toUser, recipient, funding.balances, chain.slug]);
  // Withdraw: a pasted Solana address means Solana; a 0x address on Solana means Base.
  const [showNetworks, setShowNetworks] = useState(false);
  useEffect(() => {
    if (toUser) return;
    const d = destination.trim();
    if (!d) return;
    if (chain.kind === 'evm' && isValidDestination('solana', d)) setChain(SEND_CHAINS.find((c) => c.slug === 'solana')!);
    else if (chain.kind === 'solana' && /^0x/i.test(d)) setChain(SEND_CHAINS[1]!);
  }, [toUser, destination, chain.kind]);


  function reset() {
    setStep('form');
    setFlowError(null);
    setTxResult(null);
    setAmountDisplay('');
    setDestination('');
    setUsername(presetUsername ?? '');
    setRecipient(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function applyMax() {
    if (isUsdc && funding.balances.total !== null) {
      setAmountDisplay((Math.floor(spendableUsd * 100) / 100).toFixed(2));
      return;
    }
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
    if (needsMove) {
      try {
        await funding.move();
      } catch (err) {
        setFlowError(funding.error ?? friendlyError(err));
        setStep('failed');
        return;
      }
    }
    try {
      const to = destination.trim();
      let result: string;
      if (chain.kind === 'evm') {
        result =
          asset.kind === 'native'
            ? await sendEvmNative(to as `0x${string}`, amountRaw, chain.evmChainId!)
            : await sendEvmToken(asset.address as `0x${string}`, to as `0x${string}`, amountRaw, chain.evmChainId!);
      } else {
        if (!solanaConnection || !solanaWallet) throw new Error(tU('solanaWalletNotConnected_9663'));
        const from = new PublicKey(solanaWallet.address);
        const toKey = new PublicKey(to);
        // Kamby sends just the SOL this withdrawal needs (2026-10-07: no signup gift any more).
        // Never blocks the send: a wallet that already has SOL simply goes ahead.
        if (asset.kind !== 'native') {
          await ensureSolanaWalletFunded(solanaWallet.address, { destination: to, mint: asset.address! }).catch(() => undefined);
        }
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
      // Tell them (2026-10-15): the API checks the transfer on-chain, then notifies @name.
      if (toUser && recipient && onSent) {
        onSent(result, chain.slug);
      } else if (toUser && recipient) {
        void authedFetch('/transfers/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: recipient.username, chain: chain.slug, txRef: result }),
        }).catch(() => undefined);
      }
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('failed');
    }
  }

  const isConnectedForChain =
    chain.kind === 'evm' ? Boolean(evmAddress) && evmChainId === chain.evmChainId : Boolean(solanaWallet);

  return (
    <TradeModal open={open} onClose={close}>
      <ModalHeader icon={toUser ? <Send className="h-5 w-5" aria-hidden /> : <WithdrawGlyph />} title={toUser ? tW('send') : tW('withdraw')} onClose={close} closeLabel={tU('close_d3d2')} />

      {step === 'form' && (
        <div className="mt-4 flex flex-col gap-4">
          {!toUser &&
            (showNetworks ? (
              <div>
                <NetworkPicker label={tU('network_eec8')} value={chain} onChange={setChain} />
                <p className="mt-1.5 font-body text-[0.7rem] text-ink-400">{tW('networkMustMatch')}</p>
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                <span aria-hidden className="relative h-5 w-5 shrink-0">
                  <ChainBadge chain={chain.slug as BadgeChain} className="!static !h-5 !w-5 !ring-0" />
                </span>
                <span className="min-w-0 flex-1 font-body text-sm text-ink-600">{tW('sendingOn', { chain: chain.name })}</span>
                <button type="button" onClick={() => setShowNetworks(true)} className="shrink-0 font-body text-xs font-semibold text-accent hover:underline">
                  {tW('changeNetwork')}
                </button>
              </div>
            ))}

          {assets.length > 1 && (
          <div>
            <div className="font-body text-xs text-ink-600">{tU('asset_26e9')}</div>
            <div className="mt-1.5 flex gap-1.5">
              {assets.map((a) => (
                <button
                  key={a.symbol}
                  type="button"
                  onClick={() => setAsset(a)}
                  className={cn(
                    'flex-1 rounded-full border px-2 py-2 font-body text-xs font-semibold transition-colors active:scale-[0.97]',
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
          )}

          {!isConnectedForChain ? (
            chain.kind === 'evm' ? (
              <ConnectWalletButton expectedChainId={chain.evmChainId} block />
            ) : (
              <Button type="button" className="w-full" disabled={!ready || authenticated} onClick={() => login()}>
                {!ready ? tAuth('loading') : authenticated ? tAuth('settingUp') : tAuth('signIn')}
              </Button>
            )
          ) : (
            <>
              {solanaFeeInsufficient && (
                <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 font-body text-xs text-down">
                  {tU('thisWalletHasNoSol_9431')}
                </p>
              )}
              <div>
                <div className="flex items-center justify-between font-body text-xs text-ink-600">
                  <span>{tW('amountOf', { symbol: 'USDC' })}</span>
                  {isUsdc && funding.balances.total !== null ? (
                    <span>{tW('balanceN', { n: `$${funding.balances.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })}</span>
                  ) : (
                    balance !== null && tokenDecimals !== null && (
                      <span>{tW('balanceN', { n: Number(formatUnits(balance, tokenDecimals)).toLocaleString('en-US', { maximumFractionDigits: 6 }) })}</span>
                    )
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
                    className="w-full rounded-2xl border border-white/10 bg-bg px-4 py-3.5 font-display text-3xl font-bold tabular-nums text-ink-900 placeholder:text-ink-400 focus:border-accent/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={(funding.balances.total === null || !isUsdc) && (balance === null || tokenDecimals === null)}
                    onClick={() => void applyMax()}
                    className="shrink-0 rounded-full bg-accent/15 px-4 py-2.5 font-display text-xs font-bold text-accent active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {tU('max_6a06')}
                  </button>
                </div>
                {amountDisplay && !amountValid && (
                  <p className="mt-1 font-body text-xs text-down">
                    {amountRaw === null
                      ? tW('invalidAmount')
                      : belowMinimum
                        ? tW('minimumWithdrawal', { amount: String(minimumUsd) })
                        : tW('exceedsBalance')}
                  </p>
                )}
              </div>

              {toUser ? (
                <div>
                  <div className="font-body text-xs text-ink-600">{tL('sendTo')}</div>
                  <span className="relative mt-1 block">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-sm font-bold text-accent">@</span>
                    <input
                      type="text"
                      placeholder={tL('usernamePlaceholder')}
                      value={username}
                      readOnly={presetUsername !== undefined}
                      onChange={(e) => setUsername(e.target.value.replace(/\s/g, '').slice(0, 21))}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className="w-full rounded-xl border border-line bg-bg py-2.5 pl-7 pr-3 font-body text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </span>
                  {recipient ? (
                    <div className="mt-2 flex items-center gap-2.5 rounded-xl bg-accent/10 px-3 py-2">
                      <TokenAvatar src={recipient.avatarUrl} seed={recipient.evmAddress ?? recipient.username} label={recipient.username} className="h-8 w-8 shrink-0 text-xs" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-sm font-bold text-ink-900">@{recipient.username}</span>
                        <span className="block truncate font-mono text-[0.65rem] text-ink-400">{destination ? `${destination.slice(0, 6)}…${destination.slice(-4)}` : tL('noWalletOnNetwork', { chain: chain.name })}</span>
                      </span>
                      <Check className="h-4 w-4 shrink-0 text-accent" aria-hidden />
                    </div>
                  ) : recipientError ? (
                    <p className="mt-1 font-body text-xs text-down">{recipientError}</p>
                  ) : lookingUp ? (
                    <p className="mt-1 font-body text-xs text-ink-400">…</p>
                  ) : null}
                </div>
              ) : (
              <div>
                <div className="font-body text-xs text-ink-600">
                  Destination address ({chain.kind === 'evm' ? '0x…' : 'base58'})
                </div>
                <input
                  type="text"
                  placeholder={chain.kind === 'evm' ? '0x…' : tU('solanaAddress_0f9c')}
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-line bg-bg px-3 py-2.5 font-mono text-sm text-ink-900 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                {destination.trim().length > 0 && !destinationValid && (
                  <p className="mt-1 font-body text-xs text-down">{tW('invalidAddressFor', { chain: chain.name })}</p>
                )}
              </div>
              )}

              {(needsMove || funding.stage === 'error') && <MoveNote funding={funding} target={chain.slug as BridgeChain} />}
              <Button type="button" className="w-full" disabled={!canReview} onClick={() => setStep('review')}>
                {tU('review_457d')}
              </Button>
            </>
          )}
        </div>
      )}

      {step === 'review' && tokenDecimals !== null && amountRaw !== null && (
        <div className="mt-4 flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-surface-raised p-3 font-body text-sm text-ink-900">
            {!toUser && <Row label={tU('network_eec8')} value={chain.name} />}
            <Row label={tU('amount_b2f4')} value={`$${Number(formatUnits(amountRaw, tokenDecimals)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`} />
            <Row label={tL('toLabel')} value={toUser && recipient ? `@${recipient.username} · ${destination.trim().slice(0, 6)}…${destination.trim().slice(-4)}` : destination.trim()} mono={!toUser} />
          </div>
          {needsMove && <MoveNote funding={funding} target={chain.slug as BridgeChain} />}
          <p className="font-body text-xs text-down">
            {tL('withdrawIrreversible')}
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('form')}>
              {tU('back_0557')}
            </Button>
            <Button type="button" className="flex-1" onClick={() => void confirmSend()}>
              {tL('confirmAndSend')}
            </Button>
          </div>
        </div>
      )}

      {step === 'signing' && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-body text-sm text-ink-600">{tU('confirmThisInYourWallet_26e1')}</p>
        </div>
      )}

      {step === 'confirmed' && txResult && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-black">
            <Check className="h-8 w-8" strokeWidth={3} aria-hidden />
          </span>
          <p className="font-display text-lg font-bold text-ink-900">{toUser && recipient ? tL('sentToUser', { username: recipient.username }) : tU('sent_7f8c')}</p>
          <a
            href={chain.txExplorerUrl(txResult)}
            target="_blank"
            rel="noreferrer"
            className="font-body text-xs text-accent underline-offset-2 hover:underline"
          >
            {tW('viewOn', { explorer: chain.explorerName })}
          </a>
          <Button type="button" className="w-full" onClick={close}>
            {tU('done_f929')}
          </Button>
        </div>
      )}

      {step === 'failed' && (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-down">{tU('withdrawalFailed_5e6f')}</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('review')}>
              {tU('tryAgain_f915')}
            </Button>
            <Button type="button" className="flex-1" onClick={close}>
              {tU('close_d3d2')}
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
