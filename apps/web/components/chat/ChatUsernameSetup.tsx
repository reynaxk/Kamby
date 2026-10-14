'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '@kamby/domain';
import { rememberMyProfile, updateUsername } from '@/lib/profile-client';

/**
 * Pick a name right where you want to chat (2026-10-14: the owner's dad couldn't write — most
 * accounts have no username, and the chat only linked away to the profile page). Same rules as
 * the profile page: 3–20 lowercase letters, numbers or _; the API has the last word (taken names).
 */
export function ChatUsernameSetup({ onDone }: { onDone: (username: string) => void }) {
  const t = useTranslations('tokenChat');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.length >= USERNAME_MIN_LENGTH && name.length <= USERNAME_MAX_LENGTH && USERNAME_PATTERN.test(name);

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await updateUsername(name);
      rememberMyProfile(profile);
      onDone(profile.username ?? name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="mb-1.5 px-2 font-body text-xs text-ink-400">{t('pickName')}</p>
      <div className="flex items-center gap-1.5">
        <span className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-body text-sm text-ink-400">@</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX_LENGTH));
              setError(null);
            }}
            placeholder={t('namePlaceholder')}
            aria-label={t('pickName')}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            className="h-10 w-full rounded-full bg-surface-raised pl-8 pr-4 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
          />
        </span>
        <button type="submit" disabled={!valid || busy} className="h-10 shrink-0 rounded-full bg-accent px-4 font-display text-sm font-bold text-black disabled:opacity-40">
          {t('startChatting')}
        </button>
      </div>
      <p className={`mt-1 px-2 font-body text-[0.7rem] ${error ? 'text-down' : 'text-ink-400'}`}>{error ?? t('nameRules')}</p>
    </form>
  );
}
