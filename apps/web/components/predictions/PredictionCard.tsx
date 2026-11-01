'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrivy } from '@privy-io/react-auth';
import { predictionShares, type Prediction } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { useNow } from '@/components/news/useNow';
import { friendlyError } from '@/lib/friendly-error';
import { votePrediction } from '@/lib/predictions-client';
import { marketHref } from '@/lib/solana-links';

const CATEGORY_STYLE: Record<Prediction['category'], string> = {
  crypto: 'border-[#38BDF8]/30 text-[#7DD3FC]',
  politics: 'border-[#FB923C]/30 text-[#FDBA74]',
  ai: 'border-[#A78BFA]/30 text-[#C4B5FD]',
  macro: 'border-[#FACC15]/30 text-[#FDE68A]',
  streamers: 'border-[#FF3B69]/30 text-[#FF8FA8]',
  memes: 'border-accent/30 text-accent',
};

/** Exported for tests. "2h 14m" / "14m 05s" / null once it's over. */
export function countdown(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * One prediction (2026-10-31): category, countdown, the question, and its answers drawn for its
 * kind — Yes/No and Over/Under as two big buttons over a split bar, multi-choice and ranges as a
 * list of answers with their share. One tap votes (sign-in first if needed); the shares update
 * live for everyone. Votes only — nothing to win or lose.
 */
export function PredictionCard({ p, onChange }: { p: Prediction; onChange: (next: Prediction) => void }) {
  const t = useTranslations('predictions');
  const { authenticated, login } = usePrivy();
  const now = useNow(1000).getTime();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = countdown(p.expiresAt, now);
  const open = p.status === 'ACTIVE' && left !== null;
  const shares = predictionShares(p.counts);
  const voted = p.myVote !== null;
  const showShares = voted || !open || p.total > 0;
  const coinHref = p.coin ? marketHref(p.coin.chainIdentifier, p.coin.tokenAddress) : null;

  async function vote(option: number) {
    if (!open || voted || busy) return;
    if (!authenticated) return login();
    setBusy(true);
    setError(null);
    // Shown at once; the server's answer (or the live stream) settles the real counts.
    const counts = p.counts.map((c, i) => (i === option ? c + 1 : c));
    onChange({ ...p, myVote: option, counts, total: p.total + 1 });
    try {
      onChange(await votePrediction(p.id, option));
    } catch (err) {
      onChange(p);
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const twoWay = p.kind === 'BINARY' || p.kind === 'OVER_UNDER';
  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-white/15">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full border px-2 py-0.5 font-display text-[0.65rem] font-bold uppercase tracking-wide', CATEGORY_STYLE[p.category])}>{t(`cat_${p.category}`)}</span>
        {p.live?.onAir && (
          <Link href={`/live/${p.live.roomId}`} className="flex items-center gap-1.5 rounded-full border border-[#FF3B69]/40 bg-[#FF3B69]/10 px-2 py-0.5 font-display text-[0.65rem] font-bold text-white">
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF3B69]" />
            {t('streamerLive', { name: p.live.hostUsername ?? '' })}
          </Link>
        )}
        {p.coin?.symbol && coinHref && (
          <Link href={coinHref} className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[0.65rem] font-semibold text-accent hover:bg-accent/20">
            ${p.coin.symbol.replace(/^\$+/, '')}
          </Link>
        )}
        <span className={cn('ml-auto font-mono text-[0.7rem] tabular-nums', left ? 'text-ink-600' : 'text-ink-400')}>
          {p.status === 'RESOLVED' ? t('resolved') : left ? t('endsIn', { time: left }) : t('ended')}
        </span>
      </div>
      <h3 className="font-display text-[0.98rem] font-bold leading-snug text-ink-900">{p.title}</h3>

      {twoWay ? (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {p.options.map((label, i) => {
              const yes = i === 0;
              const mine = p.myVote === i;
              const won = p.resolvedOptionIndex === i;
              return (
                <button
                  key={label}
                  type="button"
                  disabled={!open || voted || busy}
                  onClick={() => void vote(i)}
                  aria-pressed={mine}
                  className={cn(
                    'flex h-12 items-center justify-center gap-1.5 rounded-xl border font-display text-sm font-extrabold transition-colors disabled:cursor-default',
                    yes ? 'border-up/40 text-up' : 'border-down/40 text-down',
                    mine ? (yes ? 'bg-up/20' : 'bg-down/20') : open && !voted ? (yes ? 'bg-up/[0.06] hover:bg-up/15' : 'bg-down/[0.06] hover:bg-down/15') : 'bg-transparent opacity-80',
                    won && 'ring-2 ring-inset ring-current',
                  )}
                >
                  {won && <span aria-hidden>✓</span>}
                  {label}
                  {showShares && <span className="font-mono text-xs opacity-80">{shares[i]}%</span>}
                </button>
              );
            })}
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
            {showShares && p.total > 0 && (
              <>
                <span className="h-full bg-up transition-[width] duration-500" style={{ width: `${shares[0]}%` }} />
                <span className="h-full bg-down transition-[width] duration-500" style={{ width: `${shares[1]}%` }} />
              </>
            )}
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {p.options.map((label, i) => {
            const mine = p.myVote === i;
            const won = p.resolvedOptionIndex === i;
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={!open || voted || busy}
                  onClick={() => void vote(i)}
                  aria-pressed={mine}
                  className={cn(
                    'relative flex h-11 w-full items-center gap-2 overflow-hidden rounded-xl border px-3 text-left transition-colors disabled:cursor-default',
                    mine ? 'border-accent/60' : won ? 'border-up/60' : 'border-line',
                    open && !voted && 'hover:border-white/25',
                  )}
                >
                  {showShares && <span aria-hidden className={cn('absolute inset-y-0 left-0 transition-[width] duration-500', won ? 'bg-up/15' : mine ? 'bg-accent/15' : 'bg-white/[0.05]')} style={{ width: `${shares[i]}%` }} />}
                  <span className="relative min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">
                    {won && '✓ '}
                    {label}
                  </span>
                  {showShares && <span className="relative font-mono text-xs font-semibold tabular-nums text-ink-600">{shares[i]}%</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between font-body text-xs text-ink-400">
        <span>{t('votes', { count: p.total })}</span>
        {voted && <span className="text-accent">{t('youVoted', { answer: p.options[p.myVote!] ?? '' })}</span>}
        {!voted && p.author?.username && <span>@{p.author.username}</span>}
      </div>
      {error && <p className="font-body text-xs text-down">{error}</p>}
    </article>
  );
}
