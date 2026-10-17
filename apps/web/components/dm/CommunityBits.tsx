'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { DM_LIMITS, type CallState, type DmChannelInfo, type DmInvitePreview } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { createChannel, createCommunity, deleteChannel, fetchInvite, inviteUrl, joinInvite, resetInvite } from '@/lib/dm-client';
import { friendlyError } from '@/lib/friendly-error';
import { DmAvatar } from './DmAvatar';

/**
 * Communities (2026-10-17, Discord-style): a big group you join with a link, with text
 * channels (#general, #alpha …) and one 🔊 voice lounge you drop in and out of — no ringing.
 */

/** "New community" — just a name; channels and the invite link come with it. */
export function NewCommunityDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('dm');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const chat = await createCommunity(title.trim());
      router.push(`/messages/${chat.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('newCommunity')} desktop>
      <label className="block font-body text-xs font-semibold text-ink-400">{t('communityName')}</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, DM_LIMITS.groupTitleMax))}
        placeholder={t('communityNamePlaceholder')}
        className="mt-1.5 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-display text-base font-bold text-ink-900 placeholder:font-body placeholder:font-normal placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />
      <ul className="mt-4 space-y-1.5">
        {['general', 'alpha'].map((c) => (
          <li key={c} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 font-body text-sm text-ink-600">
            <span className="font-display font-bold text-ink-400">#</span>
            {c}
          </li>
        ))}
        <li className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2 font-body text-sm text-ink-600">
          <SpeakerIcon />
          {t('voiceLounge')}
        </li>
      </ul>
      <p className="mt-3 font-body text-xs text-ink-400">{t('communityNote', { max: DM_LIMITS.communityMaxMembers })}</p>
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !title.trim()}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? '…' : t('createCommunity')}
      </button>
    </MobileDrawer>
  );
}

/** The channel strip under a community's header: # text channels, then the voice lounge. */
export function ChannelBar({
  channels,
  current,
  onPick,
  lounge,
  inLounge,
  onLounge,
  canAdd,
  onAdd,
}: {
  channels: DmChannelInfo[];
  current: string | null;
  onPick: (id: string) => void;
  lounge: CallState | null;
  inLounge: boolean;
  onLounge: () => void;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const t = useTranslations('dm');
  const voice = channels.find((c) => c.kind === 'voice');
  const people = lounge?.participants.length ?? 0;
  return (
    <nav className="kamby-frost-bar-phone sticky top-[calc(env(safe-area-inset-top)+3.6rem)] z-20 border-b border-white/[0.05] md:bg-bg/90" aria-label={t('channels')}>
      <div className="mx-auto flex max-w-2xl gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {channels
          .filter((c) => c.kind === 'text')
          .map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.id)}
              aria-current={current === c.id}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 font-display text-[0.8rem] font-bold transition-colors',
                current === c.id ? 'bg-white/[0.12] text-ink-900' : 'bg-white/[0.04] text-ink-400 active:bg-white/[0.08]',
              )}
            >
              <span className={cn(current === c.id ? 'text-accent' : 'text-ink-400')}>#</span>
              {c.name}
            </button>
          ))}
        {voice && (
          <button
            type="button"
            onClick={onLounge}
            disabled={inLounge}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-display text-[0.8rem] font-bold transition-colors',
              people > 0 ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/[0.06] bg-white/[0.04] text-ink-600 active:bg-white/[0.08]',
            )}
          >
            <SpeakerIcon />
            {voice.name}
            {people > 0 && <span className="rounded-full bg-accent px-1.5 font-body text-[0.62rem] text-black">{people}</span>}
            {inLounge && <span className="font-body text-[0.65rem] font-semibold">· {t('youreIn')}</span>}
          </button>
        )}
        {canAdd && (
          <button type="button" onClick={onAdd} aria-label={t('addChannel')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-ink-400 active:bg-white/[0.08]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>
    </nav>
  );
}

/** Owner: add a text channel (or the voice lounge back), delete channels. */
export function ChannelsDrawer({
  open,
  onClose,
  id,
  channels,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  id: string;
  channels: DmChannelInfo[];
  onDone: () => void;
}) {
  const t = useTranslations('dm');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstText = channels.find((c) => c.kind === 'text')?.id;
  const hasVoice = channels.some((c) => c.kind === 'voice');

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setName('');
      onDone();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('channels')} desktop>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void act(() => createChannel(id, name.trim(), 'text'));
        }}
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 pl-4"
      >
        <span className="font-display text-base font-bold text-accent">#</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-').slice(0, DM_LIMITS.channelNameMax))}
          placeholder={t('channelPlaceholder')}
          autoCapitalize="none"
          className="min-w-0 flex-1 bg-transparent py-2 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
        <button type="submit" disabled={busy || !name.trim()} className="rounded-xl bg-accent px-4 py-2 font-display text-sm font-bold text-black disabled:opacity-40">
          {t('add')}
        </button>
      </form>
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
      <ul className="mt-3 max-h-[45vh] space-y-1 overflow-y-auto">
        {channels.map((c) => (
          <li key={c.id} className="flex items-center gap-2 rounded-xl bg-white/[0.03] px-3 py-2">
            {c.kind === 'voice' ? <SpeakerIcon /> : <span className="font-display font-bold text-ink-400">#</span>}
            <span className="min-w-0 flex-1 truncate font-body text-sm text-ink-900">{c.name}</span>
            {c.id !== firstText && (
              <button type="button" disabled={busy} onClick={() => void act(() => deleteChannel(id, c.id))} className="rounded-full bg-white/[0.06] px-2.5 py-1 font-body text-[0.65rem] font-semibold text-ink-600">
                {t('delete')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!hasVoice && (
        <button type="button" disabled={busy} onClick={() => void act(() => createChannel(id, t('voiceLounge'), 'voice'))} className="mt-3 w-full rounded-2xl bg-white/[0.06] py-3 font-display text-sm font-bold text-ink-900">
          {t('addVoiceLounge')}
        </button>
      )}
    </MobileDrawer>
  );
}

/** The invite link: copy / share, and (owner) a fresh one that retires the old. */
export function InviteDrawer({ open, onClose, id, code, isOwner, onDone }: { open: boolean; onClose: () => void; id: string; code: string | null; isOwner: boolean; onDone: () => void }) {
  const t = useTranslations('dm');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = code ? inviteUrl(code) : '';

  async function share() {
    if (!url) return;
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('inviteTitle')} desktop>
      <p className="font-body text-sm text-ink-400">{t('inviteBody')}</p>
      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 pl-4">
        <span className="min-w-0 flex-1 truncate font-body text-sm text-ink-900">{url.replace(/^https?:\/\//, '')}</span>
        <button type="button" onClick={() => void share()} className="rounded-xl bg-accent px-4 py-2 font-display text-sm font-bold text-black transition-transform active:scale-95">
          {copied ? t('copied') : t('copyLink')}
        </button>
      </div>
      {isOwner && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void resetInvite(id)
              .then(onDone)
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
          className="mt-3 font-display text-xs font-bold text-ink-400"
        >
          {busy ? '…' : t('resetLink')}
        </button>
      )}
    </MobileDrawer>
  );
}

/** /c/<code>: who's inside, then Join (one tap; you chose to come). */
export function InviteJoin({ code }: { code: string }) {
  const t = useTranslations('dm');
  const router = useRouter();
  const { ready, authenticated, login } = usePrivy();
  const [invite, setInvite] = useState<DmInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    fetchInvite(code)
      .then(setInvite)
      .catch((err: unknown) => setError(friendlyError(err)));
  }, [code, ready, authenticated]);

  async function join() {
    if (!authenticated) {
      login();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const chat = await joinInvite(code);
      router.push(`/messages/${chat.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <div className="kamby-glass relative mx-auto mt-10 max-w-sm overflow-hidden rounded-[2rem] px-6 py-9 text-center">
      {invite ? (
        <>
          <div className="flex justify-center -space-x-3">
            {invite.members.slice(0, 5).map((m) => (
              <DmAvatar key={m.userId} name={m.username} src={m.avatarUrl} className="h-12 w-12 text-sm ring-2 ring-bg" />
            ))}
          </div>
          <p className="mt-5 font-body text-xs font-semibold uppercase tracking-wider text-ink-400">{t('invitedTo')}</p>
          <h1 className="mt-1 font-display text-2xl font-black tracking-tight text-ink-900">{invite.title}</h1>
          <p className="mt-1 font-body text-sm text-ink-400">{t('members', { count: invite.memberCount })}</p>
          {error && <p className="mt-3 font-body text-xs font-semibold text-down">{error}</p>}
          {invite.alreadyIn ? (
            <button type="button" onClick={() => router.push(`/messages/${invite.conversationId}`)} className="mt-6 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black">
              {t('openCommunity')}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void join()} className="mt-6 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40">
              {busy ? '…' : authenticated ? t('joinCommunity') : t('signInToJoin')}
            </button>
          )}
        </>
      ) : error ? (
        <>
          <p className="font-display text-lg font-bold text-ink-900">{t('inviteInvalid')}</p>
          <p className="mt-1 font-body text-sm text-ink-400">{error}</p>
        </>
      ) : (
        <div className="space-y-3">
          <span className="mx-auto block h-12 w-32 animate-pulse rounded-full bg-white/[0.05]" />
          <span className="mx-auto block h-5 w-40 animate-pulse rounded-full bg-white/[0.06]" />
        </div>
      )}
    </div>
  );
}

export function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}
