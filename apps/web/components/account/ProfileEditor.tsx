'use client';

import { isValidUsername, normalizeUsername, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from '@kamby/domain';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { EmptyState } from '@/components/market/EmptyState';
import { Skeleton } from '@/components/market/Skeleton';
import { fetchMyProfile, updateUsername, uploadAvatar, type MyProfile } from '@/lib/profile-client';
import { PROFILE_UPDATED_EVENT } from './ProfileMenu';
import { useStoredSession } from '@/hooks/useStoredSession';
import { useTranslations } from 'next-intl';

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
  const tL = useTranslations('labels');
  const tU = useTranslations('ui');
  const { address } = useAccount();
  const [state, setState] = useState<State>('loading');
  const [profile, setProfile] = useState<MyProfile | null>(null);

  const [usernameInput, setUsernameInput] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSaved, setUsernameSaved] = useState(false);

  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasSession = useStoredSession();
  useEffect(() => {
    if (hasSession === null) return;
    if (!hasSession) {
      setState('no-session');
      return;
    }
    setState('loading');
    fetchMyProfile()
      .then((p) => {
        setProfile(p);
        setUsernameInput(p.username ?? '');
        setState('loaded');
      })
      .catch(() => setState('error'));
  }, [hasSession]);

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
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
      setUsernameSaved(true);
    } catch (err) {
      setUsernameError(err instanceof Error ? err.message : tU('couldNotSaveThatUsername_3770'));
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
      window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : tU('couldNotUploadThatImage_656f'));
    } finally {
      setUploadingAvatar(false);
    }
  }

  if (state === 'no-session') {
    return <EmptyState title={tU('signInToEditYour_33e1')} detail="Connect a wallet to start a session." />;
  }
  if (state === 'loading') {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }
  if (state === 'error' || !profile) {
    return <EmptyState title={tU('couldnTLoadYourProfile_82ca')} detail="Try again in a moment." />;
  }

  // One card, like Settings above it (2026-10-18 audit: the editor sat loose on the page with a
  // grey "?" for an avatar). A coin-style gradient stands in until a picture is uploaded.
  const seed = (address ?? profile.username ?? 'kamby').toLowerCase();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  const initials = profile.username ? Array.from(profile.username).slice(0, 2).join('').toUpperCase() : address ? address.slice(2, 4).toUpperCase() : 'K';
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover ring-2 ring-white/10" />
        ) : (
          <div
            aria-hidden
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-xl font-bold text-white"
            style={{
              background: `linear-gradient(135deg, hsl(${hue} 85% 55%), hsl(${(hue + 55) % 360} 80% 38%))`,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
            }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-bold text-ink-900">{tU('profilePicture_6381')}</h2>
          <p className="mt-0.5 font-body text-xs text-ink-400">{tU('pngJpegOrWebpUp_d4ac')}</p>
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
            className="mt-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 font-body text-xs font-semibold text-ink-900 transition-colors hover:border-white/20 active:scale-[0.97] disabled:opacity-50"
          >
            {uploadingAvatar ? tU('uploading_adeb') : profile.avatarUrl ? tU('changePicture_4a95') : tU('uploadAPicture_87f4')}
          </button>
          {avatarError && <p className="mt-1 font-body text-xs text-down">{avatarError}</p>}
        </div>
      </div>

      <div className="mt-4 border-t border-white/[0.06] pt-4">
        <h2 className="font-display text-sm font-bold text-ink-900">{tU('username_f603')}</h2>
        <p className="mt-0.5 font-body text-xs text-ink-400">
          3-{USERNAME_MAX_LENGTH} characters — lowercase letters, numbers, and underscores only.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <label className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 focus-within:border-accent/70">
            <span aria-hidden className="font-display text-sm font-bold text-ink-400">@</span>
            <input
              type="text"
              value={usernameInput}
              onChange={(e) => {
                setUsernameInput(e.target.value);
                setUsernameError(null);
                setUsernameSaved(false);
              }}
              placeholder="your_handle"
              aria-label={tU('username_f603')}
              maxLength={USERNAME_MAX_LENGTH}
              className="h-full min-w-0 flex-1 bg-transparent font-body text-sm text-ink-900 outline-none placeholder:text-ink-400"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveUsername()}
            disabled={savingUsername || !usernameFormatValid || usernameInput.length === 0}
            className="h-11 shrink-0 rounded-xl bg-accent px-5 font-display text-sm font-bold text-accent-ink transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingUsername ? tU('saving_eedf') : tU('save_c9cc')}
          </button>
        </div>
        {usernameError && <p className="mt-1.5 font-body text-xs text-down">{usernameError}</p>}
        {usernameSaved && !usernameError && <p className="mt-1.5 font-body text-xs text-up">{tU('usernameSaved_9dd8')}</p>}
      </div>

      {address && (
        <Link
          href={`/trader/${address}`}
          className="-mx-4 -mb-4 mt-4 flex items-center justify-between border-t border-white/[0.06] px-4 py-3.5 font-body text-sm font-semibold text-ink-900 transition-colors hover:bg-white/[0.03]"
        >
          {tL('viewPublicProfile').replace(/\s*→\s*$/, '')}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-ink-400">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
      )}
    </section>
  );
}
