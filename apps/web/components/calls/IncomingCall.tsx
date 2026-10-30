'use client';

import { useTranslations } from 'next-intl';
import type { CallState, DmConversation } from '@kamby/domain';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { GroupAvatar } from '@/components/dm/GroupBits';

/** Someone's calling (2026-10-17): a full-screen glass card with Decline / Accept (and Accept
 *  with camera for a video call). */
export function IncomingCall({ call, conv, onAccept, onDecline }: { call: CallState; conv: DmConversation; onAccept: (video: boolean) => void; onDecline: () => void }) {
  const t = useTranslations('calls');
  const caller = conv.group?.members.find((m) => m.userId === call.startedBy) ?? conv.other;
  const title = conv.group ? conv.group.title : caller?.username ? `@${caller.username}` : t('someone');
  return (
    <div className="fixed inset-0 z-[75] flex flex-col items-center justify-between bg-[#020203]/90 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)] pt-[calc(env(safe-area-inset-top)+4rem)] backdrop-blur-xl" role="dialog" aria-label={t('incoming')}>
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_28rem_at_50%_20%,rgba(0,255,135,0.14),transparent_65%)]" />
      <div className="relative flex flex-col items-center text-center">
        <span className="relative">
          <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
          {conv.group ? (
            <GroupAvatar members={conv.group.members} meId={conv.meId} className="h-28 w-28" />
          ) : (
            <DmAvatar name={caller?.username ?? null} src={caller?.avatarUrl ?? null} className="relative h-28 w-28 text-4xl" />
          )}
        </span>
        <p className="mt-6 font-display text-2xl font-black text-white">{title}</p>
        <p className="mt-1.5 font-body text-sm text-white/60">{call.video ? t('incomingVideo') : t('incomingVoice')}</p>
        {conv.group && caller?.username && <p className="mt-1 font-body text-xs text-white/40">{t('startedBy', { name: `@${caller.username}` })}</p>}
      </div>
      <div className="relative flex w-full max-w-xs items-center justify-between">
        <button type="button" onClick={onDecline} className="flex flex-col items-center gap-2" aria-label={t('decline')}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF3B69] text-white shadow-[0_10px_30px_rgba(255,59,105,0.35)] transition-transform active:scale-90">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a1 1 0 0 1-1.41-.02L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.48 2.48a1 1 0 0 1-1.41.02 11.27 11.27 0 0 0-2.67-1.85 1 1 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9Z" />
            </svg>
          </span>
          <span className="font-body text-xs text-white/70">{t('decline')}</span>
        </button>
        {call.video && (
          <button type="button" onClick={() => onAccept(true)} className="flex flex-col items-center gap-2" aria-label={t('acceptVideo')}>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white transition-transform active:scale-90">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m22 8-6 4 6 4V8Z" />
                <rect x="2" y="6" width="14" height="12" rx="2" />
              </svg>
            </span>
            <span className="font-body text-xs text-white/70">{t('acceptVideo')}</span>
          </button>
        )}
        <button type="button" onClick={() => onAccept(false)} className="flex flex-col items-center gap-2" aria-label={t('accept')}>
          <span className="flex h-16 w-16 animate-bounce items-center justify-center rounded-full bg-accent text-black shadow-[0_10px_30px_rgba(0,255,135,0.35)] [animation-duration:1.4s]">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" />
            </svg>
          </span>
          <span className="font-body text-xs text-white/70">{t('accept')}</span>
        </button>
      </div>
    </div>
  );
}
