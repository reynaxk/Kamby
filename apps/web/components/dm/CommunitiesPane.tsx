'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import type { SquadSummary } from '@kamby/domain';
import { formatCompactUsd } from '@/lib/format';
import { friendlyError } from '@/lib/friendly-error';
import { act, fetchBoard } from '@/components/squads/SquadWars';
import { CommunityAvatar, NewCommunityDrawer } from './CommunityBits';

/**
 * Messages on a wide screen (2026-10-30 redesign, owner's concepts): a Communities column next to
 * the chat list — the ones whose owners opened them up (public or invite-only, the Squad Wars
 * board), never a private one. Join a public one in a click, ask a gated one's owner, or make
 * your own.
 */
export function CommunitiesPane() {
  const t = useTranslations('squads');
  const tDm = useTranslations('dm');
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const [squads, setSquads] = useState<SquadSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchBoard('volume')
      .then((b) => !cancelled && setSquads(b.squads))
      .catch(() => !cancelled && setSquads([]));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enter(s: SquadSummary) {
    if (s.joined) return router.push(`/messages/${s.conversationId}`);
    if (!authenticated) return login();
    setBusy(s.conversationId);
    setError(null);
    try {
      if (s.visibility === 'public') {
        const chat = await act(`/squads/${s.conversationId}/join`, 'join the squad');
        router.push(`/messages/${chat.id ?? s.conversationId}`);
      } else {
        await act(`/squads/${s.conversationId}/request`, 'ask for an invite');
        setAsked((a) => new Set(a).add(s.conversationId));
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="flex h-full flex-col border-l border-white/[0.06] px-4 pb-6 pt-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-ink-900">{tDm('communities')}</h2>
        {authenticated && (
          <button type="button" onClick={() => setCreating(true)} className="h-8 rounded-lg bg-accent px-3 font-display text-xs font-black text-black">
            + {tDm('newShort')}
          </button>
        )}
      </div>
      {error && <p className="mt-3 rounded-lg bg-down/10 px-3 py-2 font-body text-xs text-down">{error}</p>}
      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:thin]">
        {squads === null ? (
          [0, 1, 2, 3].map((i) => <div key={i} className="h-[72px] shrink-0 animate-pulse rounded-2xl bg-surface" />)
        ) : squads.length === 0 ? (
          <p className="font-body text-sm text-ink-400">{t('emptyBody')}</p>
        ) : (
          squads.map((s) => (
            <div key={s.conversationId} className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
              <CommunityAvatar title={s.title} className="h-11 w-11 shrink-0 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-bold text-ink-900">{s.title}</p>
                <p className="truncate font-body text-[0.7rem] text-ink-400">
                  {t('members', { count: s.memberCount })}
                  {s.volumeUsd > 0 && <> · {formatCompactUsd(s.volumeUsd)} {t('volume')}</>}
                </p>
                {s.about && <p className="truncate font-body text-xs text-ink-600">{s.about}</p>}
              </div>
              <button
                type="button"
                disabled={busy === s.conversationId || asked.has(s.conversationId)}
                onClick={() => void enter(s)}
                className={
                  s.joined || s.visibility === 'public'
                    ? 'h-8 shrink-0 rounded-lg bg-white/[0.08] px-3 font-display text-xs font-bold text-ink-900 disabled:opacity-50'
                    : 'h-8 shrink-0 rounded-lg border border-white/10 px-3 font-display text-xs font-bold text-ink-600 disabled:opacity-60'
                }
              >
                {s.joined ? t('open') : busy === s.conversationId ? '…' : s.visibility === 'public' ? t('join') : asked.has(s.conversationId) ? `✓ ${t('asked')}` : t('requestInvite')}
              </button>
            </div>
          ))
        )}
      </div>
      <Link href="/leaderboard/squads" className="mt-3 text-center font-display text-xs font-bold text-accent">
        {t('fullRanking')}
      </Link>
      <NewCommunityDrawer open={creating} onClose={() => setCreating(false)} />
    </aside>
  );
}
