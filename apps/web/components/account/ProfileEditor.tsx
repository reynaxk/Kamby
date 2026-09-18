'use client';

import { isValidUsername, normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@kamby/domain';
import { useEffect, useRef, useState } from 'react';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchMyProfile, updateUsername, uploadAvatar, type MyProfile } from '@/lib/profile-client';
import { hasStoredSession } from '@/lib/session-client';

type State = 'no-session' | 'loading' | 'loaded' | 'error';

/** Mirrors R2StorageService's own validation (apps/api/src/media/r2-storage.service.ts) —
 *  duplicated rather than shared across the frontend/backend package boundary. This is
 *  purely a fast-feedback preview; the server is the real, authoritative check either way. */
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * The self-serve identity surface — set a username, upload a PFP. Same
 * no-session/loading/loaded/error shell WatchlistView already establishes (a Server
 * Component structurally can't see the session, which lives in localStorage). This is
 * also what the onboarding prompt (see OnboardingPrompt.tsx) opens into.
 */
export function ProfileEditor() {
  const [state, setState] = useState<State>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasStoredSession()) {
      setState('no-session');
      return;
    }
    fetchMyProfile()
      .then((p) => {
        setProfile(p);
        setUsernameInput(p.username ?? '');
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, []);

  const normalized = normalizeUsername(usernameInput);
  const usernameFormatValid = usernameInput.length === 0 || isValidUsername(normalized);

  async function saveUsername() {
    if (!isValidUsername(normalized)) {
      setUsernameError(
        `Username must be ${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters — lowercase letters, numbers, and underscores only.`,
      );
      return;
    }
    setUsernameError(null);
    setUsernameSaved(false);
    setSavingUsername(true);
    try {
      const updated = await updateUsername(normalized);
      setProfile(updated);
      setUsernameInput(updated.username ?? '');
      setUsernameSaved(true);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : 'Could not save that username.');
    } finally {
      setSavingUsername(false);
    }
  }

  async function handleAvatarFile(file: File) {
    if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
      setAvatarError('Only PNG, JPEG, and WebP images are accepted.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('That image is too large — the limit is 2MB.');
      return;
    }
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      const updated = await uploadAvatar(file);
      setProfile(updated);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not upload that image.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (state === 'no-session') {
    return <EmptyState title="Sign in to edit your profile." detail="Connect a wallet to start a session." />;
  }
  if (state === 'loading') {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }
  if (state === 'error' || !profile) {
    return <EmptyState title="Couldn't load your profile." detail="Try again in a moment." />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="font-display text-sm font-semibold text-ink-900">Profile picture</h2>
        <div className="mt-3 flex items-center gap-4">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-xl font-bold text-accent"
            >
              {(profile.username ?? '?').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleAvatarFile(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="rounded-lg border border-line px-4 py-2 font-body text-sm text-ink-600 hover:text-ink-900 disabled:opacity-50"
            >
              {uploadingAvatar ? 'Uploading…' : profile.avatarUrl ? 'Change picture' : 'Upload a picture'}
            </button>
            <p className="mt-1 font-body text-xs text-ink-400">PNG, JPEG, or WebP — up to 2MB.</p>
            {avatarError && <p className="mt-1 font-body text-xs text-down">{avatarError}</p>}
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-display text-sm font-semibold text-ink-900">Username</h2>
        <p className="mt-1 font-body text-xs text-ink-400">
          3-{USERNAME_MAX_LENGTH} characters — lowercase letters, numbers, and underscores only.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="text"
            value={usernameInput}
            onChange={(e) => {
              setUsernameInput(e.target.value);
              setUsernameError(null);
              setUsernameSaved(false);
            }}
            placeholder="your_handle"
            maxLength={USERNAME_MAX_LENGTH}
            className="w-full max-w-xs rounded-lg border border-line bg-surface px-3 py-2 font-mono text-sm text-ink-900 outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void saveUsername()}
            disabled={savingUsername || !usernameFormatValid || usernameInput.length === 0}
            className="rounded-lg bg-accent px-4 py-2 font-body text-sm font-semibold text-accent-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            {savingUsername ? 'Saving…' : 'Save'}
          </button>
        </div>
        {usernameError && <p className="mt-1 font-body text-xs text-down">{usernameError}</p>}
        {usernameSaved && !usernameError && (
          <p className="mt-1 font-body text-xs text-up">Username saved.</p>
        )}
      </section>
    </div>
  );
}
