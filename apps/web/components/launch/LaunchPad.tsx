'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useSignTransaction, useWallets } from '@privy-io/react-auth/solana';
import { useAccount } from 'wagmi';
import { getAccount, sendTransaction, switchChain, waitForTransactionReceipt } from 'wagmi/actions';
import { useTranslations } from 'next-intl';
import { Check, ImagePlus, Loader2 } from 'lucide-react';
import { LAUNCH_LIMITS, type LaunchEvmTx, type LaunchInput, type LaunchProof, type LaunchStep } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { ChainBadge } from '@/components/market/ChainBadge';
import { MoveNote, isMoveBusy } from '@/components/trading/CrossChainMove';
import { useSolanaWalletVerification } from '@/hooks/useSolanaWalletVerification';
import { useWalletVerification } from '@/hooks/useWalletVerification';
import { buildLaunchCreate, fetchLaunchpadConfig, fundLaunch, prepareLaunch, submitLaunch, uploadLaunchImage, type LaunchpadConfig } from '@/lib/launchpad-client';
import { notifyTradeConfirmed } from '@/lib/my-positions';
import { marketHref } from '@/lib/solana-links';
import { wagmiConfig } from '@/lib/wagmi-config';
import { useCrossChainFunding } from '@/lib/use-cross-chain-funding';

type Stage = 'form' | 'preparing' | 'sign1' | 'funding' | 'sign2' | 'creating' | 'done';

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

const CHAIN_BADGE: Record<string, 'solana' | 'base' | 'bnb'> = { solana: 'solana', 'eip155:8453': 'base', 'eip155:56': 'bnb' };
/** What the launch itself costs on-chain, shown before the real figure: Pump.fun's create is about
 *  0.03 SOL (its accounts + fees); on Base the smallest swap ($1) covers the deploy's gas. */
const NETWORK_COST_ESTIMATE_USD: Record<string, number> = { solana: 3.5, 'eip155:8453': 1 };
const BRIDGE_TARGET: Record<string, 'solana' | 'base' | 'bnb'> = { solana: 'solana', 'eip155:8453': 'base', 'eip155:56': 'bnb' };

/**
 * Kamby's LaunchPad (2026-10-14): create a coin in a minute, paid in USDC. Pick the network, add a
 * logo, name and ticker, choose a first buy — then two signatures: pay (USDC → the SOL the launch
 * needs, plus Kamby's fee), and create (the coin with that first buy in the same transaction, so
 * no bot buys before the creator). Lands on the coin's page, where the chat shows them as 👑.
 */
export function LaunchPad() {
  const t = useTranslations('launchpad');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const solanaWallet = wallets[0];
  const { address: evmAddress } = useAccount();
  const solanaVerification = useSolanaWalletVerification();
  const evmVerification = useWalletVerification();
  const { signTransaction } = useSignTransaction();
  const fileRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<LaunchpadConfig | null>(null);
  const [launchpad, setLaunchpad] = useState<LaunchInput['launchpad']>('pumpfun');
  const [image, setImage] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [description, setDescription] = useState('');
  const [showLinks, setShowLinks] = useState(false);
  const [links, setLinks] = useState({ website: '', twitter: '', telegram: '' });
  const [devBuy, setDevBuy] = useState<number>(LAUNCH_LIMITS.devBuyPresetsUsd[0]);
  const [customBuy, setCustomBuy] = useState('');
  const [stage, setStage] = useState<Stage>('form');
  const [error, setError] = useState<string | null>(null);
  /** Set once the pay step went through — a retry then only redoes the create. */
  const [fundedId, setFundedId] = useState<string | null>(null);

  useEffect(() => {
    fetchLaunchpadConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const pad = config?.launchpads.find((l) => l.id === launchpad);
  const chainIdentifier = pad?.chainIdentifier ?? 'solana';
  const onSolana = chainIdentifier === 'solana';
  const walletAddress = onSolana ? solanaWallet?.address : evmAddress;
  const verified = (onSolana ? solanaVerification.status : evmVerification.status) === 'verified';
  const feeUsd = config?.feeUsd ?? LAUNCH_LIMITS.defaultFeeUsd;
  const networkCostUsd = NETWORK_COST_ESTIMATE_USD[chainIdentifier] ?? 1;
  const firstBuy = customBuy !== '' ? Math.max(0, Math.min(LAUNCH_LIMITS.maxDevBuyUsd, Number(customBuy) || 0)) : devBuy;
  const totalUsd = firstBuy + networkCostUsd + feeUsd;
  const target = BRIDGE_TARGET[chainIdentifier] ?? 'solana';
  const funding = useCrossChainFunding(target, stage === 'form' ? totalUsd : null);
  const chainUsdc = funding.balances[target];
  const short = chainUsdc !== null && chainUsdc < totalUsd;
  const needsMove = short && funding.canCover && funding.stage !== 'done';
  const ticker = symbol.toUpperCase();
  const formReady = Boolean(image && name.trim() && /^[A-Za-z0-9]{1,10}$/.test(symbol) && pad?.live);
  const busy = stage !== 'form' && stage !== 'done';

  async function pickImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > LAUNCH_LIMITS.imageMaxBytes) {
      setError(t('imageTooBig'));
      return;
    }
    setUploading(true);
    try {
      const { imageId, imageUrl } = await uploadLaunchImage(file);
      setImage({ id: imageId, url: imageUrl });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  /** One step, signed: on Solana the one transaction (Kamby co-signs and sends it), on EVM each
   *  transaction sent from the wallet in order, waiting for each before the next. */
  async function sign(step: LaunchStep): Promise<LaunchProof> {
    if (step.transactionBase64) {
      if (!solanaWallet) throw new Error(t('settingUp'));
      const { signedTransaction } = await signTransaction({ transaction: base64ToBytes(step.transactionBase64), wallet: solanaWallet });
      return { signedTxBase64: bytesToBase64(signedTransaction) };
    }
    const txHashes: string[] = [];
    for (const tx of step.evmTransactions ?? ([] as LaunchEvmTx[])) {
      const chainId = tx.chainId as 8453 | 56;
      if (getAccount(wagmiConfig).chainId !== chainId) await switchChain(wagmiConfig, { chainId });
      const hash = await sendTransaction(wagmiConfig, { to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value), chainId });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId, timeout: 90_000 });
      txHashes.push(hash);
    }
    return { txHashes };
  }

  /** Runs the launch from wherever it stopped (a retry after a failed step picks up there). */
  async function launch() {
    if (!walletAddress || !image) return;
    setError(null);
    try {
      let id = fundedId;
      if (!id) {
        if (needsMove) await funding.move();
        setStage('preparing');
        const prepared = await prepareLaunch({
          launchpad,
          walletAddress,
          name: name.trim(),
          symbol: ticker,
          description: description.trim() || undefined,
          imageId: image.id,
          website: links.website || undefined,
          twitter: links.twitter || undefined,
          telegram: links.telegram || undefined,
          devBuyUsd: firstBuy,
        });
        setStage('sign1');
        const signed = await sign(prepared);
        setStage('funding');
        await fundLaunch(prepared.launch.id, signed);
        id = prepared.launch.id;
        setFundedId(id);
      }
      setStage('sign2');
      const create = await buildLaunchCreate(id);
      const signedCreate = await sign(create);
      setStage('creating');
      const live = await submitLaunch(id, signedCreate);
      setStage('done');
      notifyTradeConfirmed();
      const href = live.tokenAddress ? marketHref(live.chainIdentifier, live.tokenAddress) : null;
      if (href) router.push(href);
    } catch (e) {
      setError((e as Error).message || t('failed'));
      setStage('form');
    }
  }

  const steps: { key: Stage; label: string }[] = [
    { key: 'sign1', label: t('stepSign1') },
    { key: 'funding', label: t('stepFunding') },
    { key: 'sign2', label: t('stepSign2', { symbol: ticker }) },
    { key: 'creating', label: t('stepCreating', { symbol: ticker }) },
  ];
  const stageIndex = steps.findIndex((s) => s.key === stage);

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-32 pt-2 md:pt-8">
      <h1 className="font-display text-3xl font-black tracking-tight text-ink-900 max-md:hidden">{t('title')}</h1>
      <p className="mt-1 font-body text-sm text-ink-400 max-md:mt-0">{t('subtitle')}</p>

      {/* Network → launchpad */}
      <div className="mt-5 flex gap-2" role="radiogroup" aria-label={t('network')}>
        {(config?.launchpads ?? []).map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={launchpad === l.id}
            disabled={!l.live || busy}
            onClick={() => setLaunchpad(l.id)}
            className={cn(
              'kamby-glass flex flex-1 flex-col items-start gap-1 rounded-2xl px-3 py-2.5 text-left transition-colors',
              launchpad === l.id ? '!border !border-accent' : 'border border-transparent opacity-80',
              !l.live && 'opacity-40',
            )}
          >
            <span className="flex items-center gap-1.5 font-display text-sm font-bold text-ink-900">
              <span className="relative h-4 w-4">
                <ChainBadge chain={CHAIN_BADGE[l.chainIdentifier] ?? 'solana'} className="!static !h-4 !w-4 !ring-0" />
              </span>
              {l.chainName}
            </span>
            <span className="font-body text-[0.7rem] text-ink-400">{l.live ? l.name : `${l.name} · ${t('soon')}`}</span>
          </button>
        ))}
      </div>

      {/* Logo + name + ticker */}
      <div className="kamby-glass mt-4 rounded-3xl p-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className={cn('relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed', image ? 'border-transparent' : 'border-white/20')}
            aria-label={t('addLogo')}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {image ? <img src={image.url} alt="" className="h-full w-full object-cover" /> : uploading ? <Loader2 className="h-6 w-6 animate-spin text-ink-400" /> : <ImagePlus className="h-6 w-6 text-ink-400" />}
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void pickImage(e.target.files?.[0])} />
          <div className="min-w-0 flex-1 space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, LAUNCH_LIMITS.nameMax))}
              placeholder={t('namePlaceholder')}
              aria-label={t('name')}
              disabled={busy}
              className="h-10 w-full rounded-xl bg-surface-raised px-3 font-display text-base font-semibold text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
            />
            <span className="relative block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-base font-bold text-accent">$</span>
              <input
                value={ticker}
                onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, LAUNCH_LIMITS.symbolMax))}
                placeholder={t('tickerPlaceholder')}
                aria-label={t('ticker')}
                autoCapitalize="characters"
                disabled={busy}
                className="h-10 w-full rounded-xl bg-surface-raised pl-7 pr-3 font-display text-base font-bold uppercase text-ink-900 placeholder:normal-case placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
              />
            </span>
          </div>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, LAUNCH_LIMITS.descriptionMax))}
          placeholder={t('descriptionPlaceholder')}
          aria-label={t('description')}
          rows={2}
          disabled={busy}
          className="mt-3 w-full resize-none rounded-xl bg-surface-raised px-3 py-2.5 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
        />
        {showLinks ? (
          <div className="mt-2 space-y-2">
            {(['twitter', 'telegram', 'website'] as const).map((key) => (
              <input
                key={key}
                value={links[key]}
                onChange={(e) => setLinks((prev) => ({ ...prev, [key]: e.target.value.trim() }))}
                placeholder={t(`${key}Placeholder`)}
                aria-label={t(key)}
                inputMode="url"
                disabled={busy}
                className="h-10 w-full rounded-xl bg-surface-raised px-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
              />
            ))}
          </div>
        ) : (
          <button type="button" onClick={() => setShowLinks(true)} className="mt-2 font-body text-xs font-semibold text-accent">
            + {t('addLinks')}
          </button>
        )}
      </div>

      {/* First buy */}
      <div className="kamby-glass mt-4 rounded-3xl p-4">
        <p className="font-display text-sm font-bold text-ink-900">{t('firstBuy')}</p>
        <p className="mt-0.5 font-body text-xs text-ink-400">{t('firstBuyHint')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[0, ...LAUNCH_LIMITS.devBuyPresetsUsd].map((usd) => (
            <button
              key={usd}
              type="button"
              disabled={busy}
              onClick={() => {
                setDevBuy(usd);
                setCustomBuy('');
              }}
              className={cn('h-9 rounded-full px-4 font-display text-sm font-bold', customBuy === '' && devBuy === usd ? 'bg-accent text-black' : 'bg-surface-raised text-ink-900')}
            >
              {usd === 0 ? t('none') : `$${usd}`}
            </button>
          ))}
          <input
            value={customBuy}
            onChange={(e) => setCustomBuy(e.target.value.replace(/[^0-9.]/g, '').slice(0, 7))}
            placeholder={t('custom')}
            inputMode="decimal"
            aria-label={t('custom')}
            disabled={busy}
            className={cn('h-9 w-24 rounded-full bg-surface-raised px-4 font-display text-sm font-bold text-ink-900 placeholder:font-normal placeholder:text-ink-400 focus:outline-none', customBuy !== '' && 'ring-1 ring-accent')}
          />
        </div>
      </div>

      {/* What it costs */}
      <dl className="mt-4 space-y-1.5 px-2 font-body text-sm">
        <Row label={t('summaryFirstBuy')} value={`$${firstBuy.toFixed(2)}`} />
        <Row label={t('summaryNetwork')} value={`≈ $${networkCostUsd.toFixed(2)}`} />
        <Row label={t('summaryFee')} value={`$${feeUsd.toFixed(2)}`} />
        <div className="border-t border-white/5 pt-1.5">
          <Row label={t('summaryTotal')} value={`≈ $${totalUsd.toFixed(2)}`} strong />
        </div>
      </dl>

      {needsMove && <div className="mt-2">{<MoveNote funding={funding} target={target} />}</div>}
      {error && <p className="mt-3 text-center font-body text-xs font-semibold text-down">{error}</p>}

      {/* The action, or where the launch is */}
      <div className="mt-5">
        {!ready ? null : !authenticated ? (
          <button type="button" onClick={() => login()} className="h-12 w-full rounded-2xl bg-accent font-display text-base font-bold text-black">
            {tAuth('signIn')} — {t('toLaunch')}
          </button>
        ) : !walletAddress || !verified ? (
          <p className="text-center font-body text-sm text-ink-400" role="status">
            {t('settingUp')}
          </p>
        ) : busy || stage === 'done' ? (
          <ol className="kamby-glass space-y-2.5 rounded-3xl p-4">
            {stage === 'preparing' && <li className="font-body text-sm text-ink-400">{t('stepPrepare')}</li>}
            {steps.map((s, i) => {
              const doneStep = stage === 'done' || (stageIndex > i && stageIndex !== -1);
              const current = s.key === stage;
              return (
                <li key={s.key} className={cn('flex items-center gap-2.5 font-body text-sm', current ? 'text-ink-900' : doneStep ? 'text-up' : 'text-ink-400')}>
                  <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full', doneStep ? 'bg-up/15' : 'bg-white/5')}>
                    {doneStep ? <Check className="h-3 w-3" aria-hidden /> : current ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <span className="text-[0.6rem]">{i + 1}</span>}
                  </span>
                  {s.label}
                </li>
              );
            })}
            {stage === 'done' && <li className="pt-1 text-center font-display text-base font-bold text-accent">{t('done', { symbol: ticker })}</li>}
          </ol>
        ) : (
          <button
            type="button"
            disabled={!formReady || uploading || isMoveBusy(funding) || (short && !funding.canCover)}
            onClick={() => void launch()}
            className="h-12 w-full rounded-2xl bg-accent font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {fundedId ? t('retry') : t('launch', { symbol: ticker || '…' })}
          </button>
        )}
        {short && !funding.canCover && stage === 'form' && <p className="mt-2 text-center font-body text-xs text-down">{t('notEnough', { amount: totalUsd.toFixed(2) })}</p>}
        <p className="mt-3 text-center font-body text-[0.7rem] text-ink-400">{t('risk')}</p>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-semibold text-ink-900' : 'text-ink-400'}>{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-display font-bold text-ink-900' : 'text-ink-900')}>{value}</dd>
    </div>
  );
}
