'use client';

import { useNativeTrading } from '@/lib/native-trading';
import { friendlyError } from '@/lib/friendly-error';
import { useEffect, useMemo, useState } from 'react';
import { useAddFunds, usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { Button, cn } from '@kamby/ui';
import { CHAIN_REGISTRY, type EvmChainConfig } from '@kamby/domain';
import QRCode from 'qrcode';
import { useAccount } from 'wagmi';
import { fetchEvmChainConfigs } from '@/lib/market-client';
import { assetsForChain, SEND_CHAINS, type SendChainOption, type SendChainSlug } from '@/lib/send';
import { TradeModal } from '../trading/TradeModal';
import { Check, ChevronRight, Copy, CreditCard } from 'lucide-react';
import { ChainBadge } from '../market/ChainBadge';
import { ConnectWalletButton } from './ConnectWalletButton';
import { NetworkPicker } from './NetworkPicker';
import { DepositGlyph, ModalHeader } from './ModalHeader';
import { useTranslations } from 'next-intl';

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
export function FundModal({ open, onClose, initialChain }: { open: boolean; onClose: () => void; initialChain?: SendChainSlug }) {
  const tU = useTranslations('ui');
  const tF = useTranslations('fund');
  const { ready, authenticated, login } = usePrivy();
  const { address: evmAddress, chainId: evmChainId } = useAccount();
  const { wallets: solanaWallets } = useSolanaWallets();
  const solanaWallet = solanaWallets[0];
  const { addFunds } = useAddFunds();
  // Native-coin trading (2026-11-01): deposits are each chain's own coin, and every network shows.
  const native = useNativeTrading();

  const [chain, setChain] = useState<SendChainOption>(SEND_CHAINS[1]!); // Base — matches privyConfig.defaultChain
  const coin = chain.kind === 'evm' ? (chain.slug === 'bnb' ? 'BNB' : 'ETH') : 'SOL';
  // One deposit network (2026-10-13): Base, unless someone's exchange needs another.
  const [showNetworks, setShowNetworks] = useState(false);
  // Opened from a chain's own "Deposit" button: start on that chain.
  useEffect(() => {
    const preset = initialChain ? SEND_CHAINS.find((c) => c.slug === initialChain) : undefined;
    if (open && preset) setChain(preset);
  }, [open, initialChain]);
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
    if (!depositAddress || (!native && !usdc?.address)) return;
    setSubmitting(true);
    setFlowError(null);
    try {
      await addFunds({
        destination: {
          address: depositAddress,
          chain: chain.kind === 'evm' ? CHAIN_REGISTRY[chain.slug === 'bnb' ? 'bnb' : 'base'].identifier : SOLANA_FUND_CHAIN,
          asset: native ? 'native-currency' : usdc!.address!,
        },
        fiat: {},
      });
      close(); // Privy's own modal already showed submitted/confirmed status before returning
    } catch (err) {
      setFlowError(friendlyError(err));
      setStep('error');
      setSubmitting(false);
    }
  }

  const networkPicker = <NetworkPicker label={tF('network')} value={chain} onChange={setChain} />;

  const back = (
    <button type="button" onClick={() => setStep('choose')} className="font-body text-xs text-ink-400 hover:text-ink-900">
      {tF('otherWays')}
    </button>
  );

  return (
    <TradeModal open={open} onClose={close}>
      <ModalHeader icon={step === 'buy' ? <CreditCard className="h-5 w-5" aria-hidden /> : <DepositGlyph />} title={step === 'buy' ? tF('buyUsdc') : tF('deposit')} onClose={close} closeLabel={tF('close')} />

      {!authenticated ? (
        <div className="mt-4">
          <Button type="button" className="w-full" disabled={!ready} onClick={() => login()}>
            {!ready ? tF('loading') : tF('signInToDeposit')}
          </Button>
        </div>
      ) : native && step !== 'error' ? (
        <div className="mt-4 flex flex-col gap-4">
          <div role="tablist" className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.04] p-1">
            {(['deposit', 'buy'] as const).map((id) => {
              const on = id === 'buy' ? step === 'buy' : step !== 'buy';
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setStep(id)}
                  className={cn('h-9 rounded-lg font-display text-sm font-bold transition-colors', on ? 'bg-white/[0.09] text-ink-900' : 'text-ink-400 hover:text-ink-900')}
                >
                  {id === 'buy' ? tF('tabBuy') : tF('deposit')}
                </button>
              );
            })}
          </div>
          <ChainChips value={chain} onChange={setChain} only={step === 'buy' ? CARD_CHAINS : undefined} />
          {step === 'buy' ? (
            !isConnectedForChain ? (
              chain.kind === 'evm' ? (
                <ConnectWalletButton expectedChainId={chain.evmChainId} block />
              ) : (
                <p className="font-body text-sm text-ink-600">{tF('settingUpSolana')}</p>
              )
            ) : (
              <Button type="button" className="w-full" disabled={submitting || !CARD_CHAINS.includes(chain.slug)} onClick={() => void startFunding()}>
                {submitting ? tF('opening') : tF('buyCoin', { coin })}
              </Button>
            )
          ) : depositAddress ? (
            <NativeDeposit address={depositAddress} networkName={chain.name} coin={coin} onBuy={CARD_CHAINS.includes(chain.slug) ? () => setStep('buy') : undefined} />
          ) : (
            <p className="font-body text-sm text-ink-600">{tF('settingUpChain', { chain: chain.name })}</p>
          )}
        </div>
      ) : step === 'choose' ? (
        <div className="mt-4 flex flex-col gap-2">
          <MethodButton icon={<DepositGlyph />} title={native ? tF('depositCrypto') : tF('depositUsdc')} detail={native ? tF('depositCryptoDetail') : tF('depositUsdcDetail')} onClick={() => setStep('deposit')} />
          <MethodButton
            icon={<CreditCard className="h-5 w-5" aria-hidden />}
            title={tF('buyWithCard')}
            detail={tF('buyWithCardDetail')}
            onClick={() => setStep('buy')}
          />
        </div>
      ) : step === 'deposit' ? (
        <div className="mt-4 flex flex-col gap-4">
          {native || showNetworks || chain.slug !== 'base' ? (
            networkPicker
          ) : (
            <div>
              <p className="font-body text-xs text-ink-600">{tF('depositOneNetwork')}</p>
              <button type="button" onClick={() => setShowNetworks(true)} className="mt-1.5 font-body text-xs font-semibold text-accent underline-offset-2 hover:underline">
                {tF('otherNetworks')}
              </button>
            </div>
          )}
          {depositAddress ? (
            <DepositAddress address={depositAddress} networkName={chain.name} coin={native ? coin : undefined} />
          ) : (
            <p className="font-body text-sm text-ink-600">{tF('settingUpChain', { chain: chain.name })}</p>
          )}
          {back}
        </div>
      ) : step === 'buy' ? (
        <div className="mt-4 flex flex-col gap-4">
          {native || showNetworks || chain.slug !== 'base' ? (
            networkPicker
          ) : (
            <div>
              <p className="font-body text-xs text-ink-600">{tF('depositOneNetwork')}</p>
              <button type="button" onClick={() => setShowNetworks(true)} className="mt-1.5 font-body text-xs font-semibold text-accent underline-offset-2 hover:underline">
                {tF('otherNetworks')}
              </button>
            </div>
          )}
          {!isConnectedForChain ? (
            chain.kind === 'evm' ? (
              <ConnectWalletButton expectedChainId={chain.evmChainId} block />
            ) : (
              <p className="font-body text-sm text-ink-600">{tF('settingUpSolana')}</p>
            )
          ) : (
            <>
              <p className="font-body text-xs text-ink-400">
                Apple Pay and Google Pay show up when your device supports them. Continuing opens Privy&rsquo;s secure payment
                flow; USDC arrives in your {chain.name} wallet.
              </p>
              <Button type="button" className="w-full" disabled={submitting || !usdc?.address} onClick={() => void startFunding()}>
                {submitting ? tF('opening') : tF('continue')}
              </Button>
            </>
          )}
          {back}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3 py-4 text-center">
          <p className="font-display text-sm font-semibold text-down">{tU('couldnTStartThePurchase_84dd')}</p>
          {flowError && <p className="font-body text-xs text-ink-600">{flowError}</p>}
          <div className="flex w-full gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep('buy')}>
              {tF('tryAgain')}
            </Button>
            <Button type="button" className="flex-1" onClick={close}>
              {tF('close')}
            </Button>
          </div>
        </div>
      )}
    </TradeModal>
  );
}

/** Card buys reach Solana, Base and BSC (Privy's on-ramp has no Robinhood Chain). */
const CARD_CHAINS: SendChainSlug[] = ['solana', 'base', 'bnb'];

/** The networks as a row of chips — the same look as the wallet's chain chips (2026-11-02). */
function ChainChips({ value, onChange, only }: { value: SendChainOption; onChange: (c: SendChainOption) => void; only?: SendChainSlug[] }) {
  const chains = SEND_CHAINS.filter((c) => !only || only.includes(c.slug));
  // Moving to Buy from Robinhood: jump to a chain that card buys reach.
  useEffect(() => {
    if (only && !only.includes(value.slug)) onChange(chains[0]!);
  }, [only, value.slug, onChange, chains]);
  return (
    <div role="radiogroup" className={cn('grid gap-1.5', chains.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
      {chains.map((c) => {
        const on = c.slug === value.slug;
        return (
          <button
            key={c.slug}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(c)}
            className={cn(
              'flex h-14 flex-col items-center justify-center gap-1 rounded-xl border font-body text-[0.7rem] font-semibold transition-colors',
              on ? 'border-accent/50 bg-accent/10 text-ink-900' : 'border-white/[0.07] bg-white/[0.02] text-ink-400 hover:text-ink-900',
            )}
          >
            <ChainBadge chain={c.slug} className="!static !h-5 !w-5 !ring-0" />
            {c.name === 'BNB Chain' ? 'BSC' : c.name.replace(' Chain', '')}
          </button>
        );
      })}
    </div>
  );
}

/** QR beside the address, one big Copy button, and a way to buy the coin with a card. */
function NativeDeposit({ address, networkName, coin, onBuy }: { address: string; networkName: string; coin: string; onBuy?: () => void }) {
  const tF = useTranslations('fund');
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(address, { margin: 1, width: 240 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [address]);
  const copy = () =>
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL
          <img src={qr} alt={`QR code for your ${networkName} address`} className="h-28 w-28 shrink-0 rounded-xl bg-white p-1.5" />
        ) : (
          <span className="h-28 w-28 shrink-0 rounded-xl bg-white/[0.04]" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-body text-xs font-semibold text-ink-400">{tF('addressOf', { coin })}</span>
          <span className="mt-1 break-all font-mono text-[0.8rem] leading-snug text-ink-900">{address}</span>
          <button type="button" onClick={copy} aria-label={tF('copyAddress')} className="mt-auto self-end rounded-lg p-1.5 text-ink-400 hover:bg-white/[0.06] hover:text-ink-900">
            {copied ? <Check className="h-4 w-4 text-up" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </div>
      <p className="font-body text-xs text-ink-400">
        {tF.rich('sendOnlyCoin', { coin, network: networkName, b: (chunks) => <span className="font-semibold text-ink-900">{chunks}</span> })}
      </p>
      {onBuy && (
        <p className="font-body text-xs text-ink-400">
          {tF('noCoin', { coin })}{' '}
          <button type="button" onClick={onBuy} className="font-semibold text-accent hover:underline">
            {tF('buyCard')}
          </button>
        </p>
      )}
      <Button type="button" className="w-full" onClick={copy}>
        {copied ? tF('copied') : tF('copyAddress')}
      </Button>
    </div>
  );
}

function MethodButton({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-surface-raised px-4 py-3.5 text-left transition-[transform,border-color] hover:border-accent/50 active:scale-[0.98]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-sm font-bold text-ink-900">{title}</span>
        <span className="mt-0.5 block font-body text-xs text-ink-600">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" aria-hidden />
    </button>
  );
}

/** This wallet's own address for the picked network: text, a QR code and a copy button. */
function DepositAddress({ address, networkName, coin }: { address: string; networkName: string; coin?: string }) {
  const tF = useTranslations('fund');
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
        <img src={qr} alt={`QR code for your ${networkName} address`} className="h-44 w-44 rounded-2xl bg-white p-2.5" />
      )}
      <div className="w-full break-all rounded-2xl border border-white/10 bg-surface-raised px-3 py-2.5 text-center font-mono text-xs text-ink-900">{address}</div>
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
        {copied ? tF('copied') : tF('copyAddress')}
      </Button>
      <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-body text-xs text-ink-900">
        {coin
          ? tF.rich('sendOnlyCoin', { coin, network: networkName, b: (chunks) => <span className="font-semibold">{chunks}</span> })
          : tF.rich('sendOnly', { network: networkName, b: (chunks) => <span className="font-semibold">{chunks}</span> })}
      </p>
    </div>
  );
}
