'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AtSign, ChevronDown, Copy, LogOut, Pencil, User, Wallet } from 'lucide-react';
import { cn } from '@kamby/ui';
import { fetchMyProfile, type MyProfile } from '@/lib/profile-client';
import { useTranslations } from 'next-intl';

/** Fired by ProfileEditor after a username/avatar change so the header updates in place. */
export const PROFILE_UPDATED_EVENT = 'kamby:profile-updated';

/**
 * The header's signed-in state (2026-09-30, user request): a profile avatar — the user's own
 * picture once they've set one, a default icon until then — instead of the wallet address.
 * The address is still one click away ("Copy wallet address") but never printed on screen
 * the moment someone signs in. The menu holds the ways into the account: the public profile,
 * the wallet tools (Fund / Send / hide balances live on /account now) and sign-out.
 */
export function ProfileMenu({ address, onSignOut }: { address: string; onSignOut: () => void }) {
  const tU = useTranslations('ui');
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchMyProfile()
        .then((p) => !cancelled && setProfile(p))
        .catch(() => {}); // no profile yet — the default avatar is the honest fallback
    void load();
    window.addEventListener(PROFILE_UPDATED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PROFILE_UPDATED_EVENT, load);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const displayName = profile?.username ? `@${profile.username}` : tU('yourAccount_f2fc');
  const itemClass = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left font-body text-sm text-ink-900 hover:bg-surface-raised';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={tU('openYourProfileMenu_2945')}
        className="flex items-center gap-1 rounded-full p-0.5 pr-1.5 transition-colors hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Avatar url={profile?.avatarUrl ?? null} />
        <ChevronDown className={cn('h-3.5 w-3.5 text-ink-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <Avatar url={profile?.avatarUrl ?? null} />
            <span className="truncate font-display text-sm font-semibold text-ink-900">{displayName}</span>
          </div>
          {profile && !profile.username && (
            // Skipping the onboarding prompt must never lose the way back to it.
            <Link
              role="menuitem"
              href="/account#profile"
              onClick={() => setOpen(false)}
              className="mx-1 mb-1 flex items-center gap-2.5 rounded-lg bg-accent/10 px-3 py-2 font-body text-sm font-semibold text-accent hover:bg-accent/20"
            >
              <AtSign className="h-4 w-4" aria-hidden /> Set your username
            </Link>
          )}
          <div className="my-1 border-t border-line" />
          <Link role="menuitem" href={`/trader/${address}`} onClick={() => setOpen(false)} className={itemClass}>
            <User className="h-4 w-4 text-ink-400" aria-hidden /> My profile
          </Link>
          <Link role="menuitem" href="/account" onClick={() => setOpen(false)} className={itemClass}>
            <Wallet className="h-4 w-4 text-ink-400" aria-hidden /> Wallet &amp; settings
          </Link>
          <Link role="menuitem" href="/account#profile" onClick={() => setOpen(false)} className={itemClass}>
            <Pencil className="h-4 w-4 text-ink-400" aria-hidden /> Edit profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              navigator.clipboard
                .writeText(address)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {});
            }}
            className={itemClass}
          >
            <Copy className="h-4 w-4 text-ink-400" aria-hidden /> {copied ? 'Copied!' : 'Copy wallet address'}
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className={cn(itemClass, 'text-down')}
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Avatar({ url }: { url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
      <User className="h-4 w-4" />
    </span>
  );
}
