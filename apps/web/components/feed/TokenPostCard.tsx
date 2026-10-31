'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { Candle, FeedChart, Prediction } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { KambyChart } from '@/components/terminal/KambyChart';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { PredictionCard } from '@/components/predictions/PredictionCard';
import { evmChartSource, loadCandles, type ChartSource } from '@/lib/chart-data';
import { cashtag, formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';
import { fetchPredictions } from '@/lib/predictions-client';
import { fetchLeaderboard } from '@/lib/social-client';
import { marketHref } from '@/lib/solana-links';
import { useOpenCoin } from './FeedCoin';

function sourceFor(chart: FeedChart): ChartSource | null {
  if (chart.chainIdentifier === 'solana') return { kind: 'solana', mint: chart.tokenAddress };
  const id = Number(chart.chainIdentifier.split(':')[1]);
  return Number.isFinite(id) && id > 0 ? evmChartSource(chart.tokenAddress, id) : null;
}

/** Exported for tests. How far the price has moved since the post, in %. */
export function sincePosted(postedUsd: number, nowUsd: number | null): number | null {
  return nowUsd && postedUsd > 0 ? (nowUsd / postedUsd - 1) * 100 : null;
}

// This week's top traders, fetched once per page for the rank badge.
let topTraders: Promise<Map<string, number>> | null = null;
function useRank(userId: string): number | null {
  const [rank, setRank] = useState<number | null>(null);
  useEffect(() => {
    topTraders ??= fetchLeaderboard('7d', 50)
      .then((b) => new Map(b.entries.map((e, i) => [e.userId, i + 1])))
      .catch(() => new Map());
    let alive = true;
    void topTraders.then((m) => alive && setRank(m.get(userId) ?? null));
    return () => {
      alive = false;
    };
  }, [userId]);
  return rank;
}

/** The author's weekly rank as a small badge — only for this week's top 50. */
export function RankBadge({ userId }: { userId: string }) {
  const t = useTranslations('feed');
  const rank = useRank(userId);
  if (!rank) return null;
  return (
    <span className={cn('rounded-full px-1.5 py-px font-mono text-[0.6rem] font-bold', rank <= 3 ? 'bg-[#FACC15]/15 text-[#FACC15]' : 'bg-white/[0.06] text-ink-600')} title={t('rankTitle')}>
      #{rank}
    </span>
  );
}

/** Polls about this coin, in a sheet. */
function PredictSheet({ chart, open, onClose }: { chart: FeedChart; open: boolean; onClose: () => void }) {
  const t = useTranslations('feed');
  const [items, setItems] = useState<Prediction[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    fetchPredictions({ filter: 'all', coin: { chainIdentifier: chart.chainIdentifier, tokenAddress: chart.tokenAddress } })
      .then((p) => alive && setItems(p.items.filter((x) => x.status === 'ACTIVE')))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [open, chart.chainIdentifier, chart.tokenAddress]);
  return (
    <MobileDrawer open={open} onClose={onClose} title={t('predictTitle', { symbol: cashtag(chart.symbol ?? '') })} desktop>
      {items === null ? (
        <div className="h-40 animate-pulse rounded-2xl bg-white/[0.04]" />
      ) : items.length === 0 ? (
        <div className="py-6 text-center">
          <p className="font-body text-sm text-ink-400">{t('predictNone')}</p>
          <Link href="/predictions" onClick={onClose} className="mt-3 inline-block font-display text-sm font-bold text-accent">
            {t('predictAll')}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((p) => (
            <PredictionCard key={p.id} p={p} onChange={(next) => setItems((cur) => (cur ?? []).map((x) => (x.id === next.id ? next : x)))} />
          ))}
        </div>
      )}
    </MobileDrawer>
  );
}

/**
 * A coin shared with its chart (2026-10-31): the coin, its price when posted and how it has
 * moved since, a live chart (loaded only once the card is on screen, so a long feed doesn't fetch
 * every chart at once), and three actions — Quick trade (the chart + buy sheet), Predict (polls
 * about this coin) and Share.
 */
export function TokenPostCard({ chart, author }: { chart: FeedChart; author: string }) {
  const t = useTranslations('feed');
  const openCoin = useOpenCoin();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [copied, setCopied] = useState(false);
  const source = sourceFor(chart);
  const href = marketHref(chart.chainIdentifier, chart.tokenAddress);
  const label = cashtag(chart.symbol ?? chart.tokenAddress.slice(0, 6));

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !source) return;
    let alive = true;
    loadCandles(source, '5m')
      .then((c) => alive && setCandles(c))
      .catch(() => alive && setCandles([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the source is fixed per post
  }, [visible]);

  const now = candles && candles.length > 0 ? candles[candles.length - 1]!.close : null;
  const since = sincePosted(chart.priceUsd, now);

  async function share() {
    const url = `${window.location.origin}${href ?? '/feed'}`;
    const text = t('shareText', { author, symbol: label });
    try {
      if (navigator.share) await navigator.share({ title: text, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // the sheet was closed
    }
  }

  const coinRef = { chainIdentifier: chart.chainIdentifier, tokenAddress: chart.tokenAddress, symbol: chart.symbol, logoUrl: chart.logoUrl };
  return (
    <div ref={ref} className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-[#040507]">
      <div className="flex items-center gap-3 px-3.5 pt-3">
        <TokenAvatar src={chart.logoUrl} seed={chart.tokenAddress} label={chart.symbol} className="h-9 w-9 text-xs" />
        <div className="min-w-0 flex-1">
          {href ? (
            <Link href={href} className="font-display text-sm font-extrabold text-ink-900 hover:text-accent">
              {label}
            </Link>
          ) : (
            <span className="font-display text-sm font-extrabold text-ink-900">{label}</span>
          )}
          <p className="font-mono text-[0.65rem] text-ink-400">
            {t('postedAt', { price: formatPrice(chart.priceUsd) })}
            {chart.marketCapUsd ? ` · ${formatCompactUsd(chart.marketCapUsd)} MC` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-bold tabular-nums text-ink-900">{now !== null ? formatPrice(now) : '—'}</p>
          {since !== null && <p className={cn('font-mono text-[0.7rem] font-semibold tabular-nums', since >= 0 ? 'text-up' : 'text-down')}>{t('sincePosted', { pct: formatPercent(since) })}</p>}
        </div>
      </div>
      <div className="mt-2 h-[160px] px-1">
        {candles && candles.length > 1 ? (
          <KambyChart candles={candles} chartStyle="line" entryPrice={chart.priceUsd} />
        ) : (
          <div className={cn('mx-2 h-full rounded-xl bg-white/[0.03]', candles === null && 'animate-pulse')} />
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5 border-t border-white/[0.06] p-2">
        <button type="button" onClick={() => openCoin?.(coinRef)} disabled={!openCoin} className="h-9 rounded-xl bg-accent font-display text-xs font-black text-black disabled:opacity-40">
          ⚡ {t('quickTrade')}
        </button>
        <button type="button" onClick={() => setPredicting(true)} className="h-9 rounded-xl border border-white/10 font-display text-xs font-bold text-ink-900 hover:bg-white/[0.04]">
          🎯 {t('predict')}
        </button>
        <button type="button" onClick={() => void share()} className="h-9 rounded-xl border border-white/10 font-display text-xs font-bold text-ink-900 hover:bg-white/[0.04]">
          {copied ? t('copied') : `↗ ${t('share')}`}
        </button>
      </div>
      <PredictSheet chart={chart} open={predicting} onClose={() => setPredicting(false)} />
    </div>
  );
}
