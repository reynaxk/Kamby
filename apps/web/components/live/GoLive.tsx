'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LIVE_CATEGORIES, LIVE_LIMITS, type LiveCategory } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { startLive } from '@/lib/live-engine';
import { friendlyError } from '@/lib/friendly-error';
import { setPendingHost } from './pending-host';

/** "Go live" (2026-10-17): a title, then you're on air with your mic — share your screen from
 *  the room. Voice + screen only (no camera), see @kamby/domain live.ts. */
export function GoLiveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('live');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<LiveCategory>('chart');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const join = await startLive(title.trim(), undefined, category);
      setPendingHost(join.room.id, { me: join.room.host.userId, join });
      router.push(`/live/${join.room.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('goLive')} desktop>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, LIVE_LIMITS.titleMax))}
        placeholder={t('titlePlaceholder')}
        className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3.5 font-display text-base font-bold text-ink-900 placeholder:font-body placeholder:font-normal placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />
      <p className="mt-4 font-display text-xs font-bold text-ink-600">{t('pickCategory')}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {LIVE_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            aria-pressed={category === c}
            className={cn('h-9 rounded-full border px-3.5 font-display text-xs font-bold', category === c ? 'border-accent/40 bg-accent/[0.1] text-accent' : 'border-line bg-surface text-ink-600')}
          >
            {t(`cat_${c}`)}
          </button>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 font-body text-xs text-ink-400">
        <li>🎙️ {t('ruleVoice')}</li>
        <li>🖥️ {t('ruleScreen')}</li>
        <li>📷 {t('ruleNoCamera')}</li>
      </ul>
      {error && <p className="mt-3 font-body text-xs font-semibold text-down">{error}</p>}
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy || !title.trim()}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF3B69] py-3.5 font-display text-base font-black text-white transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        <span className="h-2 w-2 rounded-full bg-white" />
        {busy ? '…' : t('goLive')}
      </button>
    </MobileDrawer>
  );
}
