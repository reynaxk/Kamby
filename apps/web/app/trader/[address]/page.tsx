import type { Metadata } from 'next';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { AppBackBar } from '@/components/layout/AppBackBar';
import { notFound } from 'next/navigation';
import { ActivityFeed } from '@/components/social/ActivityFeed';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { TraderProfileActions } from '@/components/social/TraderProfileActions';
import { PnlValue } from '@/components/social/PnlValue';
import { ShareButton } from '@/components/social/ShareButton';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { MarketHeader } from '@/components/market/MarketHeader';
import { TraderTokensList } from '@/components/discovery/TraderTokensList';
import { formatCompactUsd, formatDateTime, truncateAddress } from '@/lib/format';
import { fetchTraderActivity, fetchTraderProfile } from '@/lib/social-api';
import { fetchTraderTokens } from '@/lib/discovery-api';
import { settledOr } from '@/lib/settled-fetch';
import { getTranslations } from 'next-intl/server';

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
  const profile = await fetchTraderProfile(params.address);
  if (!profile) notFound();

  // Local const so JSX below narrows it past `null` inside the .map callback — `null`
  // means this wallet has no linked Kamby account (real and common, see
  // TraderRealizedPnlSchema's own comment in packages/domain/src/pnl.ts), not "loading".
  const realizedPnl = profile.realizedPnl;

  // Secondary sections — a failure here shouldn't take down a profile that otherwise
  // loaded fine, so each degrades to its own empty state rather than crashing the page.
  const [activity, tokens] = await Promise.all([
    settledOr(fetchTraderActivity(params.address, { limit: 20 }), { items: [], nextCursor: null }),
    settledOr(fetchTraderTokens(params.address, 10), []),
  ]);

  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader className="max-md:hidden" />
      <AppBackBar fallback="/leaderboard" />
      <main className="mx-auto max-w-3xl px-6 py-10 max-md:px-4 max-md:pt-0">
        <Link href="/terminal" className="font-mono text-xs text-ink-400 hover:text-ink-900 max-md:hidden">
          ← Back to Discover
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 max-md:mt-0">
          <div className="flex items-center gap-2">
            <TraderIdentity
              address={profile.address}
              displayName={profile.username}
              avatarUrl={profile.avatarUrl}
              size="lg"
            />
            <CopyAddressButton address={profile.address} />
          </div>
          <div className="flex items-center gap-2">
            <TraderProfileActions address={profile.address} initialFollowing={profile.isFollowedByMe} />
            <ShareButton
              title={`${profile.username ?? truncateAddress(profile.address)} on Kamby`}
              path={`/trader/${profile.address}`}
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 max-md:mt-4 max-md:gap-x-4 max-md:gap-y-1">
          <Stat label={tU('totalTrades_c59a')} value={profile.stats.totalSwaps.toString()} />
          <Stat
            label={tU('buysSells_e13b')}
            value={`${profile.stats.buyCount} / ${profile.stats.sellCount}`}
          />
          <Stat label={tU('volume_bd7a')} value={formatCompactUsd(profile.stats.volumeUsd)} />
          <Stat label={tU('followers_24c7')} value={profile.followerCount.toString()} />
        </div>
        <p className="mt-3 font-body text-xs text-ink-400">
          First seen trading {formatDateTime(profile.stats.firstSeenAt)}
          {profile.stats.lastActiveAt && (
            <> · last active {formatDateTime(profile.stats.lastActiveAt)}</>
          )}
        </p>

        {realizedPnl && (
          <Surface className="mt-6 p-5 max-md:mt-8 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
            <h2 className="mb-1 font-display text-sm font-semibold text-ink-900">
              {tU('realizedPnl_4c8e')}
            </h2>
            <p className="mb-4 font-body text-xs text-ink-400">
              {tU('onlyTradesPlacedThroughKamby_3831')}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PNL_WINDOWS.map((window) => {
                const stats = realizedPnl[window];
                return (
                  <div key={window} className="rounded-lg border border-line bg-surface p-4 max-md:rounded-none max-md:border-0 max-md:border-b max-md:border-white/5 max-md:bg-transparent max-md:px-0">
                    <div className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">
                      {window}
                    </div>
                    <div className="mt-1.5">
                      <PnlValue usd={stats.realizedPnlUsd} pct={stats.realizedPnlPct} size="lg" />
                    </div>
                    <div className="mt-1 font-mono text-[0.65rem] text-ink-400">
                      {formatCompactUsd(stats.volumeUsd)} matched
                    </div>
                  </div>
                );
              })}
            </div>
          </Surface>
        )}

        {profile.stats.totalSwaps > 0 && (
          <Surface className="mt-6 p-5 max-md:mt-8 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
            <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">
              {tU('tradingBehavior_2f0a')}
            </h2>
            <p className="mb-4 font-body text-xs text-ink-400">
              Derived only from this wallet&apos;s own confirmed, indexed trades — not investment
              advice.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={tU('uniqueTokens_976c')} value={profile.stats.uniqueTokensTraded.toString()} />
              <Stat
                label={tU('avgTradeSize_97d4')}
                value={formatCompactUsd(profile.stats.avgTradeSizeUsd)}
              />
              <Stat label={tU('largestTrade_7a79')} value={formatCompactUsd(profile.stats.largestTradeUsd)} />
              <Stat
                label={tU('buyRatio_a251')}
                value={
                  profile.stats.buyRatio !== null
                    ? `${(profile.stats.buyRatio * 100).toFixed(0)}%`
                    : '—'
                }
                title={tU('shareOfThisWalletS_01eb')}
              />
              <Stat label="24h volume" value={formatCompactUsd(profile.stats.volume24hUsd)} />
              <Stat label="24h trades" value={profile.stats.tradeCount24h.toString()} />
              <Stat
                label={tU('concentration_c9e7')}
                value={
                  profile.stats.concentrationIndex !== null
                    ? `${(profile.stats.concentrationIndex * 100).toFixed(0)}%`
                    : '—'
                }
                title={tU('howConcentratedThisWalletS_6f8c')}
              />
              <Stat
                label={tU('tradesDay_6e02')}
                value={
                  profile.stats.activityFrequencyPerDay !== null
                    ? profile.stats.activityFrequencyPerDay.toFixed(2)
                    : '—'
                }
              />
            </div>
          </Surface>
        )}

        {tokens.length > 0 && (
          <Surface className="mt-6 p-5 max-md:mt-8 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
            <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">{tU('tokensTraded_4a89')}</h2>
            <TraderTokensList tokens={tokens} />
          </Surface>
        )}

        <Surface className="mt-6 p-5 max-md:mt-8 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">{tU('recentActivity_f7ce')}</h2>
          <ActivityFeed
            initialItems={activity.items}
            initialCursor={activity.nextCursor}
            scope={{ type: 'trader', address: profile.address }}
            emptyTitle="No trades yet."
            emptyDetail={`${truncateAddress(profile.address)} hasn't traded on a tracked market recently.`}
          />
        </Surface>
      </main>
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 max-md:rounded-none max-md:border-0 max-md:border-b max-md:border-white/5 max-md:bg-transparent max-md:px-0 max-md:py-2.5" title={title}>
      <div className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400 max-md:text-xs max-md:normal-case max-md:tracking-normal">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink-900 max-md:mt-0.5 max-md:text-lg">{value}</div>
    </div>
  );
}
