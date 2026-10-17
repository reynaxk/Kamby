'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DmConversation } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { fetchConversations, sendDmTrade } from '@/lib/dm-client';
import { hasStoredSession } from '@/lib/session-client';
import { friendlyError } from '@/lib/friendly-error';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { GroupAvatar } from '@/components/dm/GroupBits';
import { CommunityAvatar } from '@/components/dm/CommunityBits';
import { haptic } from '@/components/dm/DmMessageView';

export type ShareChain = 'solana' | 'base' | 'bnb' | 'robinhood';

/**
 * "⚡ Share to chat" after a buy (2026-10-17, owner's pick: only when the trader chooses) — pick
 * chats, groups or communities; each gets your Trade Card (your real entry) so friends can Copy
 * Snipe it. Nothing is ever posted for you automatically.
 */
export function ShareTradeSheet({ open, onClose, chain, tokenAddress }: { open: boolean; onClose: () => void; chain: ShareChain; tokenAddress: string }) {
  const t = useTranslations('snipe');
  const router = useRouter();
  const [chats, setChats] = useState<DmConversation[] | null>(null);
  const [sent, setSent] = useState<Record<string, 'busy' | 'done' | string>>({});

  useEffect(() => {
    if (!open || !hasStoredSession()) return;
    fetchConversations('chats')
      .then((rows) => setChats(rows.filter((c) => c.state === 'active' && !c.blocked)))
      .catch(() => setChats([]));
  }, [open]);

  async function share(c: DmConversation) {
    setSent((s) => ({ ...s, [c.id]: 'busy' }));
    try {
      await sendDmTrade(c.id, chain, tokenAddress);
      haptic(12);
      setSent((s) => ({ ...s, [c.id]: 'done' }));
    } catch (err) {
      setSent((s) => ({ ...s, [c.id]: friendlyError(err) }));
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('shareTitle')} desktop>
      <p className="font-body text-sm text-ink-400">{t('shareBody')}</p>
      {chats === null ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="block h-14 animate-pulse rounded-2xl bg-white/[0.04]" />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <p className="py-6 text-center font-body text-sm text-ink-400">{t('noChats')}</p>
      ) : (
        <ul className="mt-3 max-h-[52vh] space-y-1 overflow-y-auto">
          {chats.map((c) => {
            const state = sent[c.id];
            const name = c.group ? c.group.title : c.other?.username ? `@${c.other.username}` : '…';
            const failed = state && state !== 'busy' && state !== 'done';
            return (
              <li key={c.id} className="flex items-center gap-3 rounded-2xl px-1 py-2">
                {c.group?.community ? (
                  <CommunityAvatar title={c.group.title} className="h-11 w-11 text-xs" />
                ) : c.group ? (
                  <GroupAvatar members={c.group.members} meId={c.meId} className="h-11 w-11" />
                ) : (
                  <DmAvatar name={c.other?.username ?? null} src={c.other?.avatarUrl ?? null} className="h-11 w-11 text-sm" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold text-ink-900">{name}</span>
                  {failed && <span className="block truncate font-body text-[0.7rem] text-down">{state}</span>}
                </span>
                <button
                  type="button"
                  disabled={state === 'busy' || state === 'done'}
                  onClick={() => void share(c)}
                  className={cn(
                    'shrink-0 rounded-full px-4 py-1.5 font-display text-xs font-bold transition-transform active:scale-95',
                    state === 'done' ? 'bg-white/[0.08] text-accent' : 'bg-accent text-black disabled:opacity-60',
                  )}
                >
                  {state === 'done' ? `✓ ${t('sent')}` : state === 'busy' ? '…' : t('send')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {Object.values(sent).includes('done') && (
        <button
          type="button"
          onClick={() => {
            onClose();
            router.push('/messages');
          }}
          className="mt-3 w-full rounded-2xl bg-white/[0.06] py-3 font-display text-sm font-bold text-ink-900"
        >
          {t('openMessages')}
        </button>
      )}
    </MobileDrawer>
  );
}
