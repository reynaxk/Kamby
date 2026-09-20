'use client';

import { useEffect, useState } from 'react';
import { THESIS_MAX_LENGTH, type TokenThesis, type TokenTraderConnection } from '@kamby/domain';
import Link from 'next/link';
import { EmptyState } from '@/components/market/EmptyState';
import { TraderIdentity } from '@/components/social/TraderIdentity';
import { fetchTheses, setMyThesis } from '@/lib/discovery-client';
import { formatRelativeTime } from '@/lib/format';

/** Token → trader connection — see docs/TRADER_INTELLIGENCE.md#token-to-trader. Reuses the
 *  same TraderIdentity avatar/name rendering as everywhere else a trader appears.
 *
 * `tokenAddress`/`chainId` (new alongside `connection`) exist only so this panel can fetch
 * its own Theses independently — theses aren't part of TokenTraderConnection (a separate
 * table, separate lifecycle: a thesis is edited far less often than trades happen), and
 * self-fetching here avoids threading a second data source through both of this panel's
 * call sites' (DiscoverTerminal, KambyTerminal) existing fetch-orchestration effects. Same
 * self-contained pattern TrenchesPanel/LeaderboardSidebar already use elsewhere in this app.
 */
export function TokenTradersPanel({
  connection,
  tokenAddress,
  chainId,
}: {
  connection: TokenTraderConnection;
  tokenAddress: string;
  chainId: number;
}) {
  const totalBuySell = connection.buyCount24h + connection.sellCount24h;
  const buyPct = totalBuySell > 0 ? (connection.buyCount24h / totalBuySell) * 100 : 0;

  if (connection.recentTraders.length === 0) {
    return (
      <EmptyState
        title="No traders indexed yet."
        detail="Recent traders on this token will show up here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {(connection.uniqueTraders24h !== null || connection.watcherCount > 0) && (
        <p className="font-mono text-xs tabular-nums text-ink-400">
          {connection.uniqueTraders24h !== null && (
            <>
              <span className="font-semibold text-ink-900">{connection.uniqueTraders24h}</span>{' '}
              unique traders in the last 24h
            </>
          )}
          {connection.uniqueTraders24h !== null && connection.watcherCount > 0 && ' · '}
          {connection.watcherCount > 0 && (
            <>
              <span className="font-semibold text-ink-900">{connection.watcherCount}</span>{' '}
              {connection.watcherCount === 1 ? 'person' : 'people'} watching
            </>
          )}
        </p>
      )}

      {totalBuySell > 0 && (
        <div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-raised">
            <span className="block h-full bg-up" style={{ width: `${buyPct}%` }} />
            <span className="block h-full bg-down" style={{ width: `${100 - buyPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[0.65rem] tabular-nums">
            <span className="text-up">
              {connection.buyCount24h} buys · {connection.buyerCount24h} buyers
            </span>
            <span className="text-down">
              {connection.sellCount24h} sells · {connection.sellerCount24h} sellers
            </span>
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-ink-400">
          Recently active
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {connection.recentTraders.map((trader) => (
            <Link
              key={trader.address}
              href={`/trader/${trader.address}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5 transition-all hover:border-accent/50 hover:bg-surface-raised hover:shadow-glow-accent"
            >
              <TraderIdentity
                address={trader.address}
                displayName={trader.username}
                avatarUrl={trader.avatarUrl}
                size="sm"
              />
              <time className="shrink-0 font-mono text-[0.65rem] tabular-nums text-ink-400" suppressHydrationWarning>
                {formatRelativeTime(trader.lastTradeAt)}
              </time>
            </Link>
          ))}
        </div>
      </div>

      {connection.activeTraders.length > 0 && (
        <div>
          <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-ink-400">
            Most active today
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {connection.activeTraders.map((trader) => (
              <Link
                key={trader.address}
                href={`/trader/${trader.address}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-line p-2.5 transition-all hover:border-accent/50 hover:bg-surface-raised hover:shadow-glow-accent"
              >
                <TraderIdentity
                  address={trader.address}
                  displayName={trader.username}
                  avatarUrl={trader.avatarUrl}
                  size="sm"
                />
                <span className="shrink-0 font-mono text-[0.65rem] tabular-nums text-ink-400">
                  {trader.tradeCount24h} trades
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <ThesisSection tokenAddress={tokenAddress} chainId={chainId} />
    </div>
  );
}

function ThesisSection({ tokenAddress, chainId }: { tokenAddress: string; chainId: number }) {
  const [theses, setTheses] = useState<TokenThesis[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchTheses(tokenAddress, chainId)
      .then((result) => {
        if (cancelled) return;
        setTheses(result);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [tokenAddress, chainId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const mine = await setMyThesis(tokenAddress, chainId, text);
      setTheses((prev) => [mine, ...prev.filter((t) => t.userId !== mine.userId)]);
      setDraft('');
    } catch {
      // A failed post just leaves the draft in the box to retry — no toast system in this
      // panel to route an error through, and the compose box itself is the honest state.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h3 className="mb-2 font-mono text-xs uppercase tracking-wide text-ink-400">Thesis</h3>

      <form onSubmit={handleSubmit} className="mb-3 flex flex-col gap-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, THESIS_MAX_LENGTH))}
          placeholder="Why are you holding this? (or would you)"
          rows={2}
          className="w-full resize-none rounded-lg border border-line bg-surface-raised p-2 font-body text-xs text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.6rem] tabular-nums text-ink-400">
            {draft.length}/{THESIS_MAX_LENGTH}
          </span>
          <button
            type="submit"
            disabled={!draft.trim() || submitting}
            className="rounded-md bg-accent px-2.5 py-1 font-display text-[0.65rem] font-bold uppercase tracking-wide text-accent-ink disabled:opacity-40"
          >
            {submitting ? 'Posting…' : 'Post thesis'}
          </button>
        </div>
      </form>

      {status === 'loading' && <p className="font-body text-xs text-ink-400">Loading…</p>}
      {status === 'error' && <p className="font-body text-xs text-down">Couldn&apos;t load theses.</p>}
      {status === 'ready' && theses.length === 0 && (
        <p className="font-body text-xs text-ink-400">No one&apos;s posted a thesis on this token yet.</p>
      )}
      {status === 'ready' && theses.length > 0 && (
        <div className="flex flex-col gap-2">
          {theses.map((thesis) => (
            <div key={thesis.userId} className="rounded-lg border border-line p-2.5">
              {thesis.walletAddress ? (
                <Link href={`/trader/${thesis.walletAddress}`}>
                  <TraderIdentity address={thesis.walletAddress} displayName={thesis.username} avatarUrl={thesis.avatarUrl} size="sm" />
                </Link>
              ) : (
                <span className="font-display text-sm font-semibold text-ink-900">{thesis.username ?? 'Anonymous'}</span>
              )}
              <p className="mt-1.5 whitespace-pre-wrap font-body text-xs text-ink-600">{thesis.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
