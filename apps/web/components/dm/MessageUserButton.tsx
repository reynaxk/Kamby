'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { openConversation } from '@/lib/dm-client';
import { friendlyError } from '@/lib/friendly-error';
import { hasStoredSession } from '@/lib/session-client';

/** "Message" on a trader's profile (2026-10-17): opens (or starts) the private chat with them.
 *  Signed-in viewers only; hidden for traders without a Kamby @name. */
export function MessageUserButton({ username }: { username: string | null }) {
  const t = useTranslations('dm');
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSignedIn(hasStoredSession()), []);
  if (!username || !signedIn) return null;

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const chat = await openConversation(username!);
      router.push(`/messages/${chat.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => void open()}
        disabled={busy}
        title={error ?? undefined}
        className="flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.05] px-4 font-display text-sm font-bold text-ink-900 transition-colors hover:border-accent/50 active:scale-[0.98] disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
        </svg>
        {t('message')}
      </button>
      {error && <span className="absolute right-0 top-11 w-56 rounded-xl bg-down/10 px-3 py-2 font-body text-xs text-down">{error}</span>}
    </span>
  );
}
