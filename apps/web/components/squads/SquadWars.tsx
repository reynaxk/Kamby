'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import type { SquadBoard, SquadSort, SquadSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { authedFetch, API_BASE, expectOk, hasStoredSession } from '@/lib/session-client';
import { friendlyError } from '@/lib/friendly-error';
import { cashtag, formatCompactUsd } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { CommunityAvatar } from '@/components/dm/CommunityBits';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { haptic } from '@/components/dm/DmMessageView';

export async function fetchBoard(sort: SquadSort): Promise<SquadBoard> {
  // Signed-in viewers see which squads they're already in; anyone can look.
  const res = hasStoredSession() ? await authedFetch(`/squads?sort=${sort}`) : await fetch(`${API_BASE}/v1/squads?sort=${sort}`);
  await expectOk(res, 'load Squad Wars');
  return (await res.json()) as SquadBoard;
}

export async function act(path: string, what: string): Promise<{ id?: string; conversationId?: string; status?: string }> {
  const res = await authedFetch(path, { method: 'POST' });
  await expectOk(res, what);
  return res.json();
}

/** Gold / silver / bronze — a faceted metal hexagon with the rank inside (no glow). */
const MEDALS = [
  { fill: 'linear-gradient(150deg,#FFF1B8 0%,#F5C451 42%,#B07A1E 100%)', ink: '#3A2600', edge: 'rgba(245,196,81,0.45)' },
  { fill: 'linear-gradient(150deg,#FFFFFF 0%,#CBD5E1 45%,#7C8899 100%)', ink: '#1C2430', edge: 'rgba(203,213,225,0.4)' },
  { fill: 'linear-gradient(150deg,#FAD3B0 0%,#D08A55 45%,#7F4622 100%)', ink: '#2A1405', edge: 'rgba(208,138,85,0.45)' },
] as const;
const HEX = 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)';

export function Medal({ rank, size = 34 }: { rank: number; size?: number }) {
  const m = MEDALS[rank - 1];
  if (!m) return null;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} aria-label={`#${rank}`}>
      <span className="absolute inset-0" style={{ clipPath: HEX, background: m.edge }} aria-hidden />
      <span className="absolute inset-[2px]" style={{ clipPath: HEX, background: m.fill }} aria-hidden />
      <span className="absolute inset-[2px] opacity-40" style={{ clipPath: HEX, background: 'linear-gradient(180deg,rgba(255,255,255,0.7),transparent 45%)' }} aria-hidden />
      <span className="relative font-display font-black" style={{ color: m.ink, fontSize: size * 0.42 }}>
        {rank}
      </span>
    </span>
  );
}

function WinBar({ rate }: { rate: number | null }) {
  const pct = rate === null ? 0 : Math.round(rate * 100);
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn('block h-full rounded-full', pct >= 50 ? 'bg-up' : 'bg-down')} style={{ width: `${rate === null ? 0 : Math.max(6, pct)}%` }} />
      </span>
      <span className={cn('font-display text-[0.72rem] font-bold tabular-nums', rate === null ? 'text-ink-400' : pct >= 50 ? 'text-up' : 'text-down')}>{rate === null ? '—' : `${pct}%`}</span>
    </span>
  );
}

/**
 * Squad Wars (2026-10-17): communities ranked by their traders' month on Kamby — a podium for the
 * top three (gold in the middle), then the rest. Join a public squad in one tap; ask a gated one's
 * owner for an invite (it arrives as a message request).
 */
export function SquadWars() {
  const t = useTranslations('squads');
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const [sort, setSort] = useState<SquadSort>('volume');
  const [board, setBoard] = useState<SquadBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());

  const load = useCallback((s: SquadSort) => {
    setError(null);
    fetchBoard(s)
      .then(setBoard)
      .catch((err: unknown) => setError(friendlyError(err)));
  }, []);
  useEffect(() => load(sort), [sort, load]);

  async function enter(s: SquadSummary) {
    if (s.joined) {
      router.push(`/messages/${s.conversationId}`);
      return;
    }
    if (!authenticated) {
      login();
      return;
    }
    setBusy(s.conversationId);
    try {
      if (s.visibility === 'public') {
        const chat = await act(`/squads/${s.conversationId}/join`, 'join the squad');
        haptic(12);
        router.push(`/messages/${chat.id ?? s.conversationId}`);
      } else {
        await act(`/squads/${s.conversationId}/request`, 'ask for an invite');
        haptic();
        setAsked((a) => new Set(a).add(s.conversationId));
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  const label = (s: SquadSummary) =>
    s.joined ? t('open') : busy === s.conversationId ? '…' : s.visibility === 'public' ? t('join') : asked.has(s.conversationId) ? `✓ ${t('asked')}` : t('requestInvite');

  const squads = board?.squads ?? [];
  const podium = squads.slice(0, 3);
  const monthName = board ? new Date(`${board.month}-01T12:00:00Z`).toLocaleString([], { month: 'long' }) : '';

  return (
    <div>
      {/* Season + sort */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <span className="rounded-full border border-accent/25 bg-accent/[0.08] px-3 py-1 font-display text-[0.7rem] font-bold uppercase tracking-[0.16em] text-accent">
          {monthName ? t('season', { month: monthName }) : '…'}
        </span>
        <div className="flex gap-1 rounded-full bg-white/[0.04] p-1" role="tablist">
          {(['volume', 'winrate'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={sort === s}
              onClick={() => setSort(s)}
              className={cn('rounded-full px-3 py-1.5 font-display text-xs font-bold transition-colors', sort === s ? 'bg-white/[0.12] text-ink-900' : 'text-ink-400')}
            >
              {s === 'volume' ? t('byVolume') : t('byWinRate')}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mt-3 rounded-2xl bg-down/10 px-3 py-2 text-center font-body text-xs font-semibold text-down">{error}</p>}

      {board === null && !error ? (
        <div className="mt-6 grid grid-cols-3 items-end gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className={cn('block animate-pulse rounded-3xl bg-white/[0.04]', i === 1 ? 'h-52' : 'h-44')} />
          ))}
        </div>
      ) : squads.length === 0 ? (
        <div className="kamby-glass relative mt-6 overflow-hidden rounded-3xl px-6 py-12 text-center">
          <span className="mx-auto flex w-fit gap-1.5">
            <Medal rank={2} size={38} />
            <Medal rank={1} size={46} />
            <Medal rank={3} size={38} />
          </span>
          <p className="mt-5 font-display text-xl font-black tracking-tight text-ink-900">{t('emptyTitle')}</p>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm text-ink-400">{t('emptyBody')}</p>
          <Link href="/messages" className="mt-6 inline-block rounded-2xl bg-accent px-6 py-3 font-display text-sm font-bold text-black active:scale-[0.98]">
            {t('emptyCta')}
          </Link>
        </div>
      ) : (
        <>
          {/* Podium: #2 · #1 · #3 */}
          <div className="mt-6 grid grid-cols-3 items-end gap-2">
            {[podium[1], podium[0], podium[2]].map((s, col) =>
              s ? (
                <button
                  key={s.conversationId}
                  type="button"
                  onClick={() => void enter(s)}
                  className={cn(
                    'kamby-glass relative flex flex-col items-center rounded-3xl px-2 pb-3 text-center transition-transform active:scale-[0.98]',
                    col === 1 ? 'pt-7' : 'pt-6',
                  )}
                  style={{ borderColor: MEDALS[s.rank - 1]?.edge }}
                >
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <Medal rank={s.rank} size={col === 1 ? 38 : 32} />
                  </span>
                  <CommunityAvatar title={s.title} className={cn(col === 1 ? 'h-16 w-16 text-lg' : 'h-12 w-12 text-sm')} />
                  <span className="mt-2 w-full truncate font-display text-[0.82rem] font-black text-ink-900">{s.title}</span>
                  <span className="font-body text-[0.62rem] text-ink-400">{t('members', { count: s.memberCount })}</span>
                  <span className={cn('mt-2 font-display font-black tabular-nums text-ink-900', col === 1 ? 'text-lg' : 'text-base')}>
                    {sort === 'volume' ? formatCompactUsd(s.volumeUsd) : s.winRate === null ? '—' : `${Math.round(s.winRate * 100)}%`}
                  </span>
                  <span className="font-body text-[0.58rem] font-semibold uppercase tracking-wider text-ink-400">{sort === 'volume' ? t('volume') : t('winRate')}</span>
                  <span
                    className={cn(
                      'mt-2.5 w-full rounded-xl py-1.5 font-display text-[0.68rem] font-bold',
                      s.joined ? 'bg-white/[0.08] text-ink-900' : s.visibility === 'public' ? 'bg-accent text-black' : 'bg-white/[0.08] text-accent',
                    )}
                  >
                    {label(s)}
                  </span>
                </button>
              ) : (
                <span key={col} />
              ),
            )}
          </div>

          {/* The full ranking, with each squad's details */}
          <p className="mb-2 mt-6 px-1 font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('fullRanking')}</p>
          <ol className="space-y-2">
            {squads.map((s) => (
              <li key={s.conversationId}>
                <SquadRow s={s} sort={sort} action={label(s)} onAction={() => void enter(s)} />
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-6 text-center font-body text-[0.7rem] text-ink-400">{t('footnote')}</p>
    </div>
  );
}

function SquadRow({ s, sort, action, onAction }: { s: SquadSummary; sort: SquadSort; action: string; onAction: () => void }) {
  const t = useTranslations('squads');
  const tokenHref = s.topToken ? marketHref(s.topToken.chainIdentifier, s.topToken.tokenAddress) : null;
  return (
    <div className="kamby-glass flex items-center gap-3 rounded-3xl p-3">
      <span className="flex w-8 shrink-0 justify-center">{s.rank <= 3 ? <Medal rank={s.rank} size={26} /> : <span className="font-display text-sm font-black tabular-nums text-ink-400">#{s.rank}</span>}</span>
      <CommunityAvatar title={s.title} className="h-11 w-11 text-xs" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-sm font-black text-ink-900">{s.title}</span>
          {s.visibility === 'gated' && <span className="shrink-0 text-[0.65rem] text-ink-400" aria-label={t('inviteOnly')}>🔒</span>}
        </span>
        {s.about && <span className="block truncate font-body text-[0.7rem] text-ink-400">{s.about}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-body text-[0.66rem] text-ink-400">
          <span>👥 {s.memberCount}</span>
          <span>⇄ {s.swaps}</span>
          <WinBar rate={s.winRate} />
          {s.topToken &&
            (tokenHref ? (
              <Link href={tokenHref} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 rounded-full bg-white/[0.05] py-0.5 pl-0.5 pr-2 font-semibold text-ink-600">
                <TokenAvatar src={s.topToken.logoUrl} seed={s.topToken.tokenAddress} label={s.topToken.symbol ?? '?'} className="h-4 w-4 text-[0.45rem]" />
                {cashtag(s.topToken.symbol ?? '?')}
              </Link>
            ) : null)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="font-display text-sm font-black tabular-nums text-ink-900">{sort === 'volume' ? formatCompactUsd(s.volumeUsd) : s.winRate === null ? '—' : `${Math.round(s.winRate * 100)}%`}</span>
        <button
          type="button"
          onClick={onAction}
          className={cn(
            'rounded-full px-3 py-1 font-display text-[0.68rem] font-bold transition-transform active:scale-95',
            s.joined ? 'bg-white/[0.08] text-ink-900' : s.visibility === 'public' ? 'bg-accent text-black' : 'bg-white/[0.08] text-accent',
          )}
        >
          {action}
        </button>
      </span>
    </div>
  );
}
