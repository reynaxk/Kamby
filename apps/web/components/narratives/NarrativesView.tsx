'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { heatTier, type HeatTier, type NarrativeSummary, type NarrativeToken, type NarrativesSnapshot } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { Sparkline } from '@/components/market/Sparkline';
import { Skeleton } from '@/components/market/Skeleton';
import { badgeChainFor, ChainBadge } from '@/components/market/ChainBadge';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { cashtag, formatCompactUsd, formatPercent, formatPrice } from '@/lib/format';
import { useNarratives } from '@/lib/narratives-client';
import { marketHref } from '@/lib/solana-links';

type Filter = 'all' | 'superheated' | 'live' | 'liquid';
const FILTERS: Filter[] = ['all', 'superheated', 'live', 'liquid'];
/** "High liquidity": the narrative's coins hold at least this much in their pools. */
const HIGH_LIQUIDITY_USD = 1_000_000;

const TIER_STYLE: Record<HeatTier, { bar: string; text: string }> = {
  superheated: { bar: 'bg-[linear-gradient(90deg,#FB923C,#FF3B69)]', text: 'text-[#FF3B69]' },
  hot: { bar: 'bg-[linear-gradient(90deg,#FACC15,#FB923C)]', text: 'text-[#FB923C]' },
  warming: { bar: 'bg-[#FACC15]', text: 'text-[#FACC15]' },
  cool: { bar: 'bg-ink-400', text: 'text-ink-400' },
};

/** Exported for tests. Which narratives a filter keeps. */
export function applyNarrativeFilter(list: NarrativeSummary[], filter: Filter): NarrativeSummary[] {
  if (filter === 'superheated') return list.filter((n) => n.heat >= 80);
  if (filter === 'live') return list.filter((n) => n.live.length > 0);
  if (filter === 'liquid') return list.filter((n) => n.liquidityUsd >= HIGH_LIQUIDITY_USD);
  return list;
}

export function HeatBar({ heat, className }: { heat: number; className?: string }) {
  const t = useTranslations('narratives');
  const tier = heatTier(heat);
  return (
    <div className={cn('flex items-center gap-2', className)} title={t('howHeat')}>
      <span className={cn('flex shrink-0 items-baseline gap-1 font-display text-sm font-extrabold tabular-nums', TIER_STYLE[tier].text)}>
        <span aria-hidden>🔥</span>
        {heat}
        <span className="text-[0.65rem] font-bold text-ink-400">/100</span>
      </span>
      <span className="relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <span className={cn('absolute inset-y-0 left-0 rounded-full transition-[width] duration-700', TIER_STYLE[tier].bar)} style={{ width: `${Math.max(3, heat)}%` }} />
      </span>
      <span className={cn('shrink-0 font-display text-[0.65rem] font-bold uppercase tracking-wide', TIER_STYLE[tier].text)}>{t(`tier_${tier}`)}</span>
    </div>
  );
}

function TokenRow({ token }: { token: NarrativeToken }) {
  const href = marketHref(token.chainIdentifier, token.tokenAddress);
  const chain = badgeChainFor(token.chainIdentifier);
  const label = cashtag(token.symbol ?? token.tokenAddress.slice(0, 6));
  const up = (token.change24hPct ?? 0) >= 0;
  const body = (
    <>
      <span className="relative shrink-0">
        <TokenAvatar src={token.logoUrl} seed={token.tokenAddress} label={token.symbol ?? token.tokenAddress} className="h-8 w-8 text-[0.65rem]" />
        {chain && <ChainBadge chain={chain} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-sm font-bold text-ink-900">{label}</span>
        <span className="block font-mono text-[0.65rem] tabular-nums text-ink-400">{formatCompactUsd(token.marketCapUsd)} MC</span>
      </span>
      {token.spark.length > 1 && (
        <span className="hidden shrink-0 sm:block">
          <Sparkline closes={token.spark} width={56} height={22} />
        </span>
      )}
      <span className="w-[5.2rem] shrink-0 text-right">
        <span className="block font-mono text-xs font-semibold tabular-nums text-ink-900">{formatPrice(token.priceUsd)}</span>
        <span className={cn('block font-mono text-[0.65rem] font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(token.change24hPct)}</span>
      </span>
    </>
  );
  return (
    <li className="flex items-center gap-2">
      {href ? (
        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-white/[0.04]">
          {body}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1.5">{body}</div>
      )}
      <QuickBuyButton chainIdentifier={token.chainIdentifier} address={token.tokenAddress} label={label} />
    </li>
  );
}

export function NarrativeCard({ n }: { n: NarrativeSummary }) {
  const t = useTranslations('narratives');
  const up = (n.change24hPct ?? 0) >= 0;
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-white/15">
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-2xl">
          {n.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-display text-base font-extrabold text-ink-900">{n.name}</h2>
            {n.live.length > 0 && (
              <Link href={`/live/${n.live[0]!.id}`} className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#FF3B69]/40 bg-[#FF3B69]/10 px-2 py-0.5 font-display text-[0.65rem] font-bold text-white">
                <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF3B69]" />
                {t('streamingNow')}
              </Link>
            )}
          </div>
          <p className="mt-0.5 font-body text-xs text-ink-400">{t('coins', { count: n.tokenCount })}</p>
        </div>
        {n.change24hPct !== null && <span className={cn('shrink-0 rounded-lg px-2 py-1 font-mono text-xs font-bold tabular-nums', up ? 'bg-up/10 text-up' : 'bg-down/10 text-down')}>{formatPercent(n.change24hPct)}</span>}
      </div>
      <HeatBar heat={n.heat} />
      <dl className="grid grid-cols-3 gap-2">
        {[
          [t('mc'), formatCompactUsd(n.marketCapUsd)],
          [t('vol1h'), formatCompactUsd(n.volume1hUsd)],
          [t('vol24h'), formatCompactUsd(n.volume24hUsd)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-white/[0.05] bg-black/30 px-2.5 py-2">
            <dt className="font-mono text-[0.6rem] uppercase tracking-wide text-ink-400">{label}</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-ink-900">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="-mx-1.5 flex flex-col">
        {n.tokens.slice(0, 5).map((token) => (
          <TokenRow key={`${token.chainIdentifier}:${token.tokenAddress}`} token={token} />
        ))}
      </ul>
    </article>
  );
}

/** The hottest few, big, in a row you can swipe. */
function HottestStrip({ list }: { list: NarrativeSummary[] }) {
  const t = useTranslations('narratives');
  if (list.length === 0) return null;
  return (
    <section aria-label={t('hottest')} className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 xl:grid-cols-5">
      {list.slice(0, 5).map((n, i) => (
        <a key={n.id} href={`#n-${n.id}`} className="flex w-[13.5rem] shrink-0 snap-start flex-col gap-2 rounded-2xl border border-line bg-surface p-3.5 transition-colors hover:border-white/15 md:w-auto">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[0.65rem] font-bold text-ink-400">#{i + 1}</span>
            <span aria-hidden className="text-lg">{n.emoji}</span>
            <span className="truncate font-display text-sm font-extrabold text-ink-900">{n.name}</span>
          </span>
          <HeatBar heat={n.heat} />
          <span className="font-mono text-[0.65rem] text-ink-400">
            {formatCompactUsd(n.volume1hUsd)} {t('vol1h')} · {formatCompactUsd(n.marketCapUsd)} {t('mc')}
          </span>
        </a>
      ))}
    </section>
  );
}

export function NarrativesView({ initial }: { initial: NarrativesSnapshot | null }) {
  const t = useTranslations('narratives');
  const snapshot = useNarratives(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMemo(() => applyNarrativeFilter(snapshot?.narratives ?? [], filter), [snapshot, filter]);

  return (
    <QuickBuyProvider>
      <div className="flex flex-col gap-5">
        {snapshot === null ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : (
          <HottestStrip list={snapshot.narratives} />
        )}
        <div role="tablist" aria-label={t('title')} className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn(
                'h-9 shrink-0 rounded-full border px-3.5 font-display text-xs font-bold transition-colors',
                filter === f ? 'border-accent/40 bg-accent/10 text-accent' : 'border-line bg-surface text-ink-600 hover:text-ink-900',
              )}
            >
              {t(`filter_${f}`)}
            </button>
          ))}
        </div>
        {snapshot === null ? (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[26rem] rounded-2xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <p className="rounded-2xl border border-line bg-surface px-5 py-8 text-center font-body text-sm text-ink-400">{filter === 'all' ? t('empty') : t('emptyFilter')}</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((n) => (
              <div key={n.id} id={`n-${n.id}`} className="scroll-mt-24">
                <NarrativeCard n={n} />
              </div>
            ))}
          </div>
        )}
        <p className="font-body text-xs leading-relaxed text-ink-400">{t('howHeat')}</p>
      </div>
    </QuickBuyProvider>
  );
}
