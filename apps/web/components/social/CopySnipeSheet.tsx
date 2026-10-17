'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isCuratedMarket, type DmTrade, type MarketSummary } from '@kamby/domain';
import { TradeModal } from '@/components/trading/TradeModal';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { SolanaTradePanel } from '@/components/trading/SolanaTradePanel';
import { CurveTradePanel } from '@/components/trading/CurveTradePanel';
import { TradePanelCard } from '@/components/terminal/TradePanelCard';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { PriceText } from '@/components/market/PriceText';
import { API_BASE } from '@/lib/session-client';
import { cashtag, formatPercent } from '@/lib/format';
import { cn } from '@kamby/ui';
import { Bolt } from './Bolt';

const EVM_CHAIN_ID: Record<string, number> = { 'eip155:8453': 8453, 'eip155:56': 56, 'eip155:4663': 4663 };

/**
 * ⚡ Copy Snipe (2026-10-17, owner's pick: two taps with a check) — the same coin in Kamby's own
 * trade sheet: pick $10 / $25 / $50 (or type one), see the price, the $ fee and the result of the
 * safety check, then Buy. The swap is the user's own, from their own USDC — nothing is copied
 * automatically.
 */
export function CopySnipeSheet({ open, onClose, trade, by, livePrice }: { open: boolean; onClose: () => void; trade: DmTrade; by: string | null; livePrice: number | null }) {
  const t = useTranslations('snipe');
  const solana = trade.chainIdentifier === 'solana';
  const chainId = EVM_CHAIN_ID[trade.chainIdentifier] ?? null;
  const [market, setMarket] = useState<MarketSummary | null | 'missing'>(null);

  useEffect(() => {
    if (!open || solana || !chainId) return;
    let cancelled = false;
    fetch(`${API_BASE}/v1/market/tokens/${encodeURIComponent(trade.tokenAddress)}?chainId=${chainId}`)
      .then((r) => (r.ok ? (r.json() as Promise<MarketSummary>) : null))
      .then((m) => !cancelled && setMarket(m ?? 'missing'))
      .catch(() => !cancelled && setMarket('missing'));
    return () => {
      cancelled = true;
    };
  }, [open, solana, chainId, trade.tokenAddress]);

  const pct = livePrice !== null && trade.entryPriceUsd > 0 ? (livePrice / trade.entryPriceUsd - 1) * 100 : null;

  return (
    <TradeModal open={open} onClose={onClose}>
      {/* The trade panels report through the terminal's toasts — chats don't have them. */}
      <ToastProvider>
      <div className="mb-4 flex items-center gap-3">
        <TokenAvatar src={trade.logoUrl} seed={trade.tokenAddress} label={trade.symbol ?? trade.tokenAddress} className="h-11 w-11 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-display text-lg font-black text-ink-900">
            <Bolt className="h-4 w-4 text-accent" />
            {t('copySnipeTitle', { symbol: cashtag(trade.symbol ?? trade.tokenAddress.slice(0, 6)) })}
          </p>
          <p className="truncate font-body text-xs text-ink-400">
            {by ? t('theirEntry', { name: by }) : t('entry')} <PriceText value={trade.entryPriceUsd} className="font-semibold text-ink-600" />
            {pct !== null && <span className={cn('ml-1.5 font-bold', pct >= 0 ? 'text-up' : 'text-down')}>{formatPercent(pct)}</span>}
          </p>
        </div>
      </div>
      <p className="-mt-2 mb-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 font-body text-[0.7rem] leading-snug text-ink-400">{t('copyNote')}</p>

      {solana ? (
        <SolanaTradePanel tokenMint={trade.tokenAddress} tokenSymbol={trade.symbol} initialSide="BUY" volatile sheet />
      ) : !chainId || market === 'missing' ? (
        <p className="py-6 text-center font-body text-sm text-ink-400">{t('cantTrade')}</p>
      ) : market === null ? (
        <div className="space-y-3 py-2">
          <span className="block h-14 animate-pulse rounded-2xl bg-white/[0.05]" />
          <span className="block h-12 animate-pulse rounded-2xl bg-white/[0.04]" />
        </div>
      ) : market.dex === 'fourmeme' ? (
        <CurveTradePanel tokenAddress={market.tokenAddress} tokenSymbol={market.symbol} initialSide="BUY" />
      ) : market.decimals !== null && market.quoteDecimals !== null ? (
        <TradePanelCard
          sheet
          initialSide="BUY"
          chainId={chainId}
          tokenAddress={market.tokenAddress}
          tokenSymbol={market.symbol}
          tokenDecimals={market.decimals}
          quoteTokenAddress={market.quoteAddress}
          quoteTokenSymbol={market.quoteSymbol}
          quoteTokenDecimals={market.quoteDecimals}
          volatile={!isCuratedMarket(market.chainIdentifier, market.tokenAddress)}
          onClose={onClose}
        />
      ) : (
        <p className="py-6 text-center font-body text-sm text-ink-400">{t('cantTrade')}</p>
      )}
      </ToastProvider>
    </TradeModal>
  );
}
