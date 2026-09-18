import type { Metadata } from 'next';
import { Surface } from '@kamby/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityFeed } from '@/components/social/ActivityFeed';
import { CopyAddressButton } from '@/components/social/CopyAddressButton';
import { FollowButton } from '@/components/social/FollowButton';
import { PnlValue } from '@/components/social/PnlValue';
import { ShareButton } from '@/components/social/ShareButton';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { MarketHeader } from '@/components/market/MarketHeader';
import { TraderTokensList } from '@/components/discovery/TraderTokensList';
import { formatCompactUsd, formatDateTime, truncateAddress } from '@/lib/format';
import { fetchTraderActivity, fetchTraderProfile } from '@/lib/social-api';
import { fetchTraderTokens } from '@/lib/discovery-api';
import { settledOr } from '@/lib/settled-fetch';

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
    <>
      <MarketHeader />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to Discover
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
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
            <FollowButton address={profile.address} initialFollowing={profile.isFollowedByMe} />
            <ShareButton
              title={`${profile.username ?? truncateAddress(profile.address)} on Kamby`}
              path={`/trader/${profile.address}`}
            />
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total trades" value={profile.stats.totalSwaps.toString()} />
          <Stat
            label="Buys / Sells"
            value={`${profile.stats.buyCount} / ${profile.stats.sellCount}`}
          />
          <Stat label="Volume" value={formatCompactUsd(profile.stats.volumeUsd)} />
          <Stat label="Followers" value={profile.followerCount.toString()} />
        </div>
        <p className="mt-3 font-body text-xs text-ink-400">
          First seen trading {formatDateTime(profile.stats.firstSeenAt)}
          {profile.stats.lastActiveAt && (
            <> · last active {formatDateTime(profile.stats.lastActiveAt)}</>
          )}
        </p>

        {realizedPnl && (
          <Surface className="mt-6 p-5">
            <h2 className="mb-1 font-display text-sm font-semibold text-ink-900">
              Realized PnL
            </h2>
            <p className="mb-4 font-body text-xs text-ink-400">
              Only trades placed through Kamby itself, matched buy-to-sell — never this
              wallet&apos;s full on-chain activity. See docs/TRADER_INTELLIGENCE.md#realized-pnl.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {PNL_WINDOWS.map((window) => {
                const stats = realizedPnl[window];
                return (
                  <div key={window} className="rounded-lg border border-line bg-surface p-4">
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
          <Surface className="mt-6 p-5">
            <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">
              Trading behavior
            </h2>
            <p className="mb-4 font-body text-xs text-ink-400">
              Derived only from this wallet&apos;s own confirmed, indexed trades — not investment
              advice. See docs/TRADER_INTELLIGENCE.md.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Unique tokens" value={profile.stats.uniqueTokensTraded.toString()} />
              <Stat
                label="Avg trade size"
                value={formatCompactUsd(profile.stats.avgTradeSizeUsd)}
              />
              <Stat label="Largest trade" value={formatCompactUsd(profile.stats.largestTradeUsd)} />
              <Stat
                label="Buy ratio"
                value={
                  profile.stats.buyRatio !== null
                    ? `${(profile.stats.buyRatio * 100).toFixed(0)}%`
                    : '—'
                }
                title="Share of this wallet's trades that were buys — 100% is buy-only, 0% is sell-only."
              />
              <Stat label="24h volume" value={formatCompactUsd(profile.stats.volume24hUsd)} />
              <Stat label="24h trades" value={profile.stats.tradeCount24h.toString()} />
              <Stat
                label="Concentration"
                value={
                  profile.stats.concentrationIndex !== null
                    ? `${(profile.stats.concentrationIndex * 100).toFixed(0)}%`
                    : '—'
                }
                title="How concentrated this wallet's volume is in a single token — higher means less diversified across tokens."
              />
              <Stat
                label="Trades / day"
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
          <Surface className="mt-6 p-5">
            <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">Tokens traded</h2>
            <TraderTokensList tokens={tokens} />
          </Surface>
        )}

        <Surface className="mt-6 p-5">
          <h2 className="mb-4 font-display text-sm font-semibold text-ink-900">Recent activity</h2>
          <ActivityFeed
            initialItems={activity.items}
            initialCursor={activity.nextCursor}
            scope={{ type: 'trader', address: profile.address }}
            emptyTitle="No activity indexed yet."
            emptyDetail={`${truncateAddress(profile.address)} hasn't traded on a tracked market recently.`}
          />
        </Surface>
      </main>
    </>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4" title={title}>
      <div className="font-mono text-[0.65rem] uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-ink-900">{value}</div>
    </div>
  );
}
