import type { Metadata } from 'next';
import { cn } from '@kamby/ui';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { notFound } from 'next/navigation';
import { ActivityFeed } from '@/components/social/ActivityFeed';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { TraderProfileActions } from '@/components/social/TraderProfileActions';
import { MessageUserButton } from '@/components/dm/MessageUserButton';
import { ShareButton } from '@/components/social/ShareButton';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { MarketHeader } from '@/components/market/MarketHeader';
import { TraderTokensList } from '@/components/discovery/TraderTokensList';
import { formatCompactUsd, formatDateTime, formatPercent, formatSignedCompactUsd, truncateAddress } from '@/lib/format';
import { fetchKambyTrades, fetchTraderActivity, fetchTraderProfile } from '@/lib/social-api';
import { KambyTradesList } from '@/components/social/KambyTradesList';
import { fetchTraderTokens } from '@/lib/discovery-api';
import { settledOr } from '@/lib/settled-fetch';
import { getTranslations } from 'next-intl/server';
import { BackPill } from '@/components/layout/BackPill';

export const revalidate = 15;

/** Public, unauthenticated metadata for link previews — see
 *  docs/PHASE6_RETENTION_SOCIAL.md#shareable-public-pages. Only the same public fields
 *  `fetchTraderProfile` already serves; a missing trader falls back to a generic title. */
export async function generateMetadata({
  params,
}: {
  params: { address: string };
}): Promise<Metadata> {
  const profile = await fetchTraderProfile(params.address);
  if (!profile) return { title: 'Trader not found — Kamby' };

  const name = profile.username ?? truncateAddress(profile.address);
  const title = `${name} — Kamby`;
  const description = `${name}'s trading activity on Kamby: ${profile.stats.totalSwaps} trades, ${formatCompactUsd(profile.stats.volumeUsd)} volume.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: 'summary', title, description },
  };
}

const PNL_WINDOWS = ['24h', '7d', '30d'] as const;

export default async function TraderProfilePage({ params }: { params: { address: string } }) {
  const tU = await getTranslations('ui');
  const tL = await getTranslations('labels');
  const profile = await fetchTraderProfile(params.address);
  if (!profile) notFound();

  // Local const so JSX below narrows it past `null` inside the .map callback — `null`
  // means this wallet has no linked Kamby account (real and common, see
  // TraderRealizedPnlSchema's own comment in packages/domain/src/pnl.ts), not "loading".
  const realizedPnl = profile.realizedPnl;

  // Secondary sections — a failure here shouldn't take down a profile that otherwise
  // loaded fine, so each degrades to its own empty state rather than crashing the page.
  const [activity, tokens, kambyTrades] = await Promise.all([
    settledOr(fetchTraderActivity(params.address, { limit: 20 }), { items: [], nextCursor: null }),
    settledOr(fetchTraderTokens(params.address, 10), []),
    settledOr(fetchKambyTrades(params.address), []),
  ]);

  // The headline on the card: the longest window with matched PnL (the PnL-card look, 2026-10-15).
  const headline = realizedPnl ? ([...PNL_WINDOWS].reverse().map((w) => realizedPnl[w]).find((w) => w.realizedPnlUsd !== null) ?? null) : null;
  const headlineUp = (headline?.realizedPnlUsd ?? 0) >= 0;

  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar fallback="/leaderboard" />
      <main className="mx-auto max-w-3xl px-6 py-10 max-md:px-4 max-md:pt-0">
        <BackPill href="/terminal" className="max-md:hidden" />

        {/* The trader's card (2026-10-15): the midnight PnL-card look — who, follow, and the
            realized PnL big in its own colour, with the faint neon K behind. */}
        <section
          className="relative mt-4 overflow-hidden rounded-3xl border border-white/[0.07] p-5 max-md:mt-1 md:p-7"
          style={{ background: 'linear-gradient(165deg,#0E1430 0%,#090C1A 50%,#05070A 100%)' }}
        >
          <svg className="pointer-events-none absolute -right-10 -top-10 h-[220px] w-[220px] md:h-[300px] md:w-[300px]" viewBox="0 0 512 512" aria-hidden="true">
            <g fill="none" stroke="#00FF87" strokeWidth="92" strokeLinecap="round" opacity="0.06">
              <path d="M186 140 V372" />
              <path d="M200 268 L338 140" />
              <path d="M232 246 L346 372" />
            </g>
          </svg>
          <div className="relative flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <TraderIdentity address={profile.address} displayName={profile.username} avatarUrl={profile.avatarUrl} size="lg" />
              <CopyAddressButton address={profile.address} />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TraderProfileActions address={profile.address} initialFollowing={profile.isFollowedByMe} />
              <MessageUserButton username={profile.username} />
              <ShareButton title={`${profile.username ?? truncateAddress(profile.address)} on Kamby`} path={`/trader/${profile.address}`} />
            </div>
          </div>

          {headline && (
            <div className="relative mt-6">
              <p className="font-body text-xs font-semibold uppercase tracking-wider text-white/50">
                {tU('realizedPnl_4c8e')} · {headline.window.toUpperCase()}
              </p>
              <p className={cn('mt-1 font-display text-5xl font-black leading-none tracking-tight tabular-nums', headlineUp ? 'text-up' : 'text-down')}>
                {formatSignedCompactUsd(headline.realizedPnlUsd)}
              </p>
              {headline.realizedPnlPct !== null && (
                <p className={cn('mt-1.5 font-body text-lg font-bold tabular-nums', headlineUp ? 'text-up' : 'text-down')}>{formatPercent(headline.realizedPnlPct)}</p>
              )}
            </div>
          )}

          <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={tU('totalTrades_c59a')} value={profile.stats.totalSwaps.toLocaleString('en-US')} />
            <Stat
              label={tU('buysSells_e13b')}
              value={`${profile.stats.buyCount.toLocaleString('en-US')} / ${profile.stats.sellCount.toLocaleString('en-US')}`}
            />
            <Stat label={tU('volume_bd7a')} value={formatCompactUsd(profile.stats.volumeUsd)} />
            <Stat label={tU('followers_24c7')} value={profile.followerCount.toLocaleString('en-US')} />
          </div>
          <p className="relative mt-3 font-body text-xs text-white/45">
            {tL('firstSeen', { date: formatDateTime(profile.stats.firstSeenAt) })}
            {profile.stats.lastActiveAt && <> · {tL('lastActive', { date: formatDateTime(profile.stats.lastActiveAt) })}</>}
          </p>
        </section>

        {realizedPnl && (
          <section className="mt-8">
            <h2 className="font-display text-base font-bold text-ink-900">{tU('realizedPnl_4c8e')}</h2>
            <p className="mt-0.5 font-body text-xs text-ink-400">{tU('onlyTradesPlacedThroughKamby_3831')}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {PNL_WINDOWS.map((window) => {
                const stats = realizedPnl[window];
                const up = (stats.realizedPnlUsd ?? 0) >= 0;
                return (
                  <div key={window} className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-3">
                    <div className="font-body text-[0.65rem] font-semibold uppercase tracking-wider text-ink-400">{window}</div>
                    <div className={cn('mt-1 truncate font-display text-lg font-bold tabular-nums', stats.realizedPnlUsd === null ? 'text-ink-400' : up ? 'text-up' : 'text-down')}>
                      {formatSignedCompactUsd(stats.realizedPnlUsd)}
                    </div>
                    {stats.realizedPnlPct !== null && (
                      <div className={cn('font-body text-xs font-semibold tabular-nums', up ? 'text-up/80' : 'text-down/80')}>{formatPercent(stats.realizedPnlPct)}</div>
                    )}
                    <div className="mt-1.5 truncate font-body text-[0.65rem] text-ink-400">{formatCompactUsd(stats.volumeUsd)} matched</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <TradeQuality trades={kambyTrades} t={{ title: tL('trackRecord'), winRate: tL('winRate'), bestTrade: tL('bestTrade'), spread: tL('pnlSpread'), lastSells: tL('lastSells', { n: '{n}' }) }} />

        {profile.stats.totalSwaps > 0 && (
          <section className="mt-8">
            {/* Folded away (2026-10-29, GMGN-simple): the headline numbers sit above; the rest on a tap. */}
            <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between font-display text-base font-bold text-ink-900 [&::-webkit-details-marker]:hidden">
              {tL('moreStats')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-400 transition-transform group-open:rotate-180">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-0.5 font-body text-xs text-ink-400">{tL('behaviorNote')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={tU('uniqueTokens_976c')} value={profile.stats.uniqueTokensTraded.toString()} />
              <Stat label={tU('avgTradeSize_97d4')} value={formatCompactUsd(profile.stats.avgTradeSizeUsd)} />
              <Stat label={tU('largestTrade_7a79')} value={formatCompactUsd(profile.stats.largestTradeUsd)} />
              <Stat
                label={tU('buyRatio_a251')}
                value={profile.stats.buyRatio !== null ? `${(profile.stats.buyRatio * 100).toFixed(0)}%` : '—'}
                title={tU('shareOfThisWalletS_01eb')}
              />
              <Stat label={tL('volume24h')} value={formatCompactUsd(profile.stats.volume24hUsd)} />
              <Stat label={tL('trades24h')} value={profile.stats.tradeCount24h.toLocaleString('en-US')} />
              <Stat
                label={tU('concentration_c9e7')}
                value={profile.stats.concentrationIndex !== null ? `${(profile.stats.concentrationIndex * 100).toFixed(0)}%` : '—'}
                title={tU('howConcentratedThisWalletS_6f8c')}
              />
              <Stat
                label={tU('tradesDay_6e02')}
                value={profile.stats.activityFrequencyPerDay !== null ? profile.stats.activityFrequencyPerDay.toFixed(2) : '—'}
              />
            </div>
            </details>
          </section>
        )}

        {tokens.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 font-display text-base font-bold text-ink-900">{tU('tokensTraded_4a89')}</h2>
            <TraderTokensList tokens={tokens} />
          </section>
        )}

        <section className="mt-8">
          <h2 className="mb-3 font-display text-base font-bold text-ink-900">{tU('recentActivity_f7ce')}</h2>
          {/* Their Kamby trades first — most never show in the indexed pools' swaps below. */}
          {kambyTrades.length > 0 ? (
            <KambyTradesList trades={kambyTrades} />
          ) : (
          <ActivityFeed
            initialItems={activity.items}
            initialCursor={activity.nextCursor}
            scope={{ type: 'trader', address: profile.address }}
            emptyTitle="No trades yet."
            emptyDetail={`${truncateAddress(profile.address)} hasn't traded on a tracked market recently.`}
          />
          )}
        </section>
      </main>
    </div>
  );
}

type KambyTradeRow = Awaited<ReturnType<typeof fetchKambyTrades>>[number];

/** GMGN-style quality (2026-10-29): win rate, best trade and how the wins spread, from the
 *  recent Kamby sells that carry a matched PnL. Nothing when there are none. */
function TradeQuality({ trades, t }: { trades: KambyTradeRow[]; t: { title: string; winRate: string; bestTrade: string; spread: string; lastSells: string } }) {
  const sells = trades
    .filter((x) => x.side === 'SELL' && x.pnlUsd !== null)
    .map((x) => {
      const cost = x.amountUsd - x.pnlUsd!;
      return { ...x, pct: cost > 0 ? (x.pnlUsd! / cost) * 100 : 0 };
    });
  if (sells.length === 0) return null;
  const wins = sells.filter((x) => x.pnlUsd! > 0).length;
  const winRate = Math.round((wins / sells.length) * 100);
  const best = sells.reduce((a, b) => (b.pnlUsd! > a.pnlUsd! ? b : a));
  const buckets = [
    { label: '>100%', n: sells.filter((x) => x.pct >= 100).length, cls: 'bg-up' },
    { label: '0–100%', n: sells.filter((x) => x.pct > 0 && x.pct < 100).length, cls: 'bg-up/45' },
    { label: '−50–0%', n: sells.filter((x) => x.pct <= 0 && x.pct > -50).length, cls: 'bg-down/45' },
    { label: '<−50%', n: sells.filter((x) => x.pct <= -50).length, cls: 'bg-down' },
  ];
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink-900">{t.title}</h2>
        <span className="font-body text-xs text-ink-400">{t.lastSells.replace('{n}', String(sells.length))}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
          <div className="font-body text-[0.68rem] text-ink-400">{t.winRate}</div>
          <div className={cn('mt-0.5 font-display text-2xl font-black tabular-nums', winRate >= 50 ? 'text-up' : 'text-down')}>{winRate}%</div>
          <div className="font-body text-[0.68rem] tabular-nums text-ink-400">
            <span className="text-up">{wins}W</span> / <span className="text-down">{sells.length - wins}L</span>
          </div>
        </div>
        <div className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
          <div className="font-body text-[0.68rem] text-ink-400">{t.bestTrade}</div>
          <div className={cn('mt-0.5 truncate font-display text-2xl font-black tabular-nums', best.pnlUsd! >= 0 ? 'text-up' : 'text-down')}>{formatSignedCompactUsd(best.pnlUsd)}</div>
          <div className="truncate font-body text-[0.68rem] tabular-nums text-ink-400">
            {best.symbol ? `${best.symbol}` : truncateAddress(best.tokenAddress)} · {formatPercent(best.pct)}
          </div>
        </div>
      </div>
      <div className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
        <div className="font-body text-[0.68rem] text-ink-400">{t.spread}</div>
        <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full">
          {buckets.map((b) => (b.n > 0 ? <span key={b.label} className={b.cls} style={{ flexGrow: b.n }} /> : null))}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {buckets.map((b) => (
            <div key={b.label} className="min-w-0">
              <div className="flex items-center gap-1 truncate font-body text-[0.62rem] text-ink-400">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.cls)} aria-hidden />
                {b.label}
              </div>
              <div className="font-display text-sm font-bold tabular-nums text-ink-900">{b.n}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5" title={title}>
      <div className="truncate font-body text-[0.68rem] text-ink-400">{label}</div>
      <div className="mt-0.5 truncate font-display text-base font-bold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
