import type { Metadata } from 'next';
import { CHAIN_REGISTRY, isChainSlug, TIMEFRAMES, type Timeframe } from '@kamby/domain';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/market/AutoRefresh';
import { MarketHeader } from '@/components/market/MarketHeader';
import { StaleBadge } from '@/components/market/StaleBadge';
import { TokenIdentity } from '@/components/market/TokenIdentity';
import { WatchButton } from '@/components/market/WatchButton';
import { ShareButton } from '@/components/social/ShareButton';
import { KambyTerminal } from '@/components/terminal/KambyTerminal';
import { formatDateTime, formatPrice, truncateAddress } from '@/lib/format';
import { fetchToken, fetchTokenHistory } from '@/lib/market-api';
import { fetchGlobalActivity } from '@/lib/social-api';
import { fetchTokenTraders } from '@/lib/discovery-api';

export const revalidate = 15;

function isTimeframe(value: string | undefined): value is Timeframe {
  return TIMEFRAMES.includes(value as Timeframe);
}

/**
 * Chain-aware as of 2026-09-16 (BNB Chain going live) — was `/market/[address]`, which had
 * no way to disambiguate which chain a given token address actually belongs to. Next.js
 * forbids two dynamic routes at the same URL position with different segment names
 * (`[address]` vs `[chain]`), so the old route was deleted outright; `next.config.mjs`'s
 * `redirects()` now sends any old bookmarked/shared `/market/:address` link to
 * `/market/base/:address` instead, matching `DEFAULT_CHAIN_SLUG`. See
 * docs/TRADING.md#chain-scope and CHAIN_REGISTRY's own doc comment for why `[chain]` is
 * the short slug ("base"/"bnb"), not the numeric id or CAIP-2 identifier — those are
 * resolved from the slug here, never accepted directly from the URL.
 *
 * Renders `<KambyTerminal>` (ported to production 2026-09-16) for the main layout — this
 * page's own job is fetching the real data (market/candles/activity/traders) and the
 * chrome the terminal doesn't own: top nav, back link, watch/share, and the market-data
 * detail table below it.
 */
export async function generateMetadata({
  params,
}: {
  params: { chain: string; address: string };
}): Promise<Metadata> {
  if (!isChainSlug(params.chain)) return { title: 'Token not found — Kamby' };
  const chainId = CHAIN_REGISTRY[params.chain].numericId;
  const market = await fetchToken(params.address, chainId);
  if (!market) return { title: 'Token not found — Kamby' };

  const name = market.symbol ?? market.name ?? truncateAddress(market.tokenAddress);
  const title =
    market.priceUsd === null ? `${name} — Kamby` : `${name} — ${formatPrice(market.priceUsd)} — Kamby`;
  const description = `${name} on ${market.chainIdentifier}: price, 24h volume, liquidity, and live trading activity.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

export default async function TokenDetailPage({
  params,
  searchParams,
}: {
  params: { chain: string; address: string };
  searchParams: { timeframe?: string };
}) {
  if (!isChainSlug(params.chain)) notFound();
  const chainId = CHAIN_REGISTRY[params.chain].numericId;
  const timeframe: Timeframe = isTimeframe(searchParams.timeframe) ? searchParams.timeframe : '1D';

  const market = await fetchToken(params.address, chainId);
  if (!market) notFound();

  const candles = await fetchTokenHistory(params.address, timeframe, chainId);
  const activity = await fetchGlobalActivity({ tokenAddress: params.address, limit: 10 });
  const traders = await fetchTokenTraders(params.address, chainId, 8);

  return (
    // kamby-void — see globals.css's own doc comment. Market detail is one of the two
    // highest-visibility pages this theme rolled out to on 2026-09-15 (Discover is the
    // other); the rest of the product still runs the original light/dark palette.
    <div className="kamby-void min-h-screen bg-bg">
      <AutoRefresh intervalSeconds={20} />
      <MarketHeader expectedWalletChainId={chainId} />
      <div className="mx-auto max-w-[1600px] px-3 pt-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="font-mono text-xs text-ink-400 hover:text-ink-900">
              ← Back to Discover
            </Link>
            <TokenIdentity
              symbol={market.symbol}
              name={market.name}
              logoUrl={market.logoUrl}
              size="sm"
            />
            <span className="rounded-full border border-line px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-wide text-ink-400">
              {market.chainIdentifier}
            </span>
            {market.isStale && <StaleBadge />}
          </div>
          <div className="flex items-center gap-2">
            <WatchButton address={market.tokenAddress} chainId={chainId} initialWatching={null} />
            <ShareButton
              title={`${market.symbol ?? market.name ?? 'Token'} on Kamby`}
              path={`/market/${params.chain}/${market.tokenAddress}`}
            />
          </div>
        </div>
      </div>

      <KambyTerminal
        chainId={chainId}
        chain={params.chain}
        market={market}
        candles={candles}
        activity={activity.items}
        traders={traders}
        timeframe={timeframe}
      />

      <main className="mx-auto max-w-[1600px] px-3 pb-10">
        <Surface className="p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">Market data</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DataRow
              label="Contract"
              value={market.tokenAddress}
              mono
              title={market.tokenAddress}
              truncate
            />
            <DataRow label="Decimals" value={market.decimals?.toString() ?? '—'} mono />
            <DataRow label="Quote token" value={market.quoteSymbol ?? '—'} />
            <DataRow label="DEX" value={market.dex ?? '—'} />
            <DataRow
              label="Fee tier"
              value={market.feeTier !== null ? `${market.feeTier / 10_000}%` : '—'}
            />
            <DataRow
              label="Last updated"
              value={market.lastPriceUpdateAt ? formatDateTime(market.lastPriceUpdateAt) : 'never'}
            />
          </dl>
        </Surface>
      </main>
    </div>
  );
}

function DataRow({
  label,
  value,
  mono,
  truncate,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line pb-2 last:border-0 sm:last:border-b">
      <dt className="font-body text-sm text-ink-400">{label}</dt>
      <dd
        title={title}
        className={
          mono
            ? `font-mono text-sm text-ink-900 ${truncate ? 'max-w-[10rem] truncate' : ''}`
            : 'font-body text-sm text-ink-900'
        }
      >
        {truncate ? truncateAddress(value) : value}
      </dd>
    </div>
  );
}
