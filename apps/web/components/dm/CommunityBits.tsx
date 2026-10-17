'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { DM_LIMITS, type CallState, type DmChannelInfo, type DmConversation, type DmInvitePreview, type DmPerson } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { createChannel, createCommunity, deleteChannel, fetchInvite, inviteUrl, joinInvite, resetInvite, updateSquad } from '@/lib/dm-client';
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
  personOf,
  className,
}: {
  className?: string;
  channels: DmChannelInfo[];
  current: string | null;
  onPick: (id: string) => void;
  lounge: CallState | null;
  inLounge: boolean;
  onLounge: () => void;
  canAdd: boolean;
  onAdd: () => void;
  personOf: (userId: string) => DmPerson | undefined;
}) {
  const t = useTranslations('dm');
  const voice = channels.find((c) => c.kind === 'voice');
  const people = lounge?.participants.length ?? 0;
  const loungeChip = voice && (
    <button
      type="button"
      onClick={onLounge}
      disabled={inLounge}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 font-display text-[0.8rem] font-bold transition-colors',
        people > 0 ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/[0.06] bg-white/[0.04] text-ink-600 active:bg-white/[0.08]',
      )}
    >
      {people > 0 ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden /> : <SpeakerIcon />}
      {voice.name}
      {people > 0 && (
        <span className="flex -space-x-1.5">
          {lounge!.participants.slice(0, 3).map((p) => {
            const who = personOf(p.userId);
            return <DmAvatar key={p.userId} name={who?.username ?? null} src={who?.avatarUrl ?? null} className="h-5 w-5 text-[0.5rem] ring-2 ring-[#0B1A14]" />;
          })}
          {people > 3 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-body text-[0.55rem] font-bold text-black ring-2 ring-[#0B1A14]">+{people - 3}</span>}
        </span>
      )}
      {inLounge && <span className="font-body text-[0.65rem] font-semibold">· {t('youreIn')}</span>}
    </button>
  );
  return (
    <nav className={cn('kamby-frost-bar-phone sticky top-[calc(env(safe-area-inset-top)+3.6rem)] z-20 border-b border-white/[0.05] md:bg-bg/90', className)} aria-label={t('channels')}>
      <div className="mx-auto flex max-w-2xl gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {people > 0 && loungeChip}
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
        {people === 0 && loungeChip}
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
    fetchInvite(code)
      .then(setInvite)
      .catch((err: unknown) => setError(friendlyError(err)));
  }, [code, authenticated]);

  async function join() {
    if (!ready) return;
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
              {busy ? '…' : authenticated || !ready ? t('joinCommunity') : t('signInToJoin')}
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

/** A community's picture: its initials on a frosted neon tile (rounded square, not a face). */
export function CommunityAvatar({ title, className }: { title: string; className?: string }) {
  const initials =
    title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => Array.from(w)[0]?.toUpperCase() ?? '')
      .join('') || '#';
  return (
    <span
      className={cn(
        'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[30%] border border-accent/25 bg-[linear-gradient(140deg,rgb(var(--kamby-accent)/0.22),rgba(14,20,48,0.9)_55%,rgba(124,92,255,0.25))] font-display font-black text-ink-900',
        className,
      )}
      aria-hidden
    >
      <span className="text-[0.95em] tracking-tight">{initials}</span>
    </span>
  );
}

/**
 * A community's home (tap its name, or swipe in from the left edge) — Discord's server panel in
 * Kamby's glass: banner, invite, # text channels, the voice lounge with who's talking, members.
 */
export function CommunityPanel({
  onClose,
  conv,
  current,
  onPick,
  lounge,
  inLounge,
  onLounge,
  isOwner,
  onInvite,
  onChannels,
  onMembers,
  onLeave,
  onSquad,
  tall = false,
}: {
  onClose: () => void;
  conv: DmConversation;
  current: string | null;
  onPick: (id: string) => void;
  lounge: CallState | null;
  inLounge: boolean;
  onLounge: () => void;
  isOwner: boolean;
  onInvite: () => void;
  onChannels: () => void;
  onMembers: () => void;
  onLeave: () => void;
  /** Owner: Squad Wars settings. */
  onSquad?: () => void;
  /** On the desktop side panel the list isn't capped — the panel scrolls. */
  tall?: boolean;
}) {
  const t = useTranslations('dm');
  const group = conv.group!;
  const channels = group.community?.channels ?? [];
  const voice = channels.find((c) => c.kind === 'voice');
  const byId = new Map(group.members.map((p) => [p.userId, p]));
  const inside = lounge?.participants ?? [];
  const row = 'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-white/[0.08]';
  return (
    <div>
      {/* Banner */}
      <div className="relative -mt-1 overflow-hidden rounded-3xl border border-white/[0.07] p-4" style={{ background: 'linear-gradient(150deg,rgb(var(--kamby-accent)/0.16) 0%,#0E1430 45%,#090C1A 100%)' }}>
        <svg className="pointer-events-none absolute -right-8 -top-8" width="150" height="150" viewBox="0 0 512 512" aria-hidden>
          <g fill="none" stroke="#FFFFFF" strokeWidth="92" strokeLinecap="round" opacity="0.05">
            <path d="M186 140 V372" />
            <path d="M200 268 L338 140" />
            <path d="M232 246 L346 372" />
          </g>
        </svg>
        <div className="relative flex items-center gap-3">
          <CommunityAvatar title={group.title} className="h-14 w-14 text-lg" />
          <div className="min-w-0">
            <p className="truncate font-display text-xl font-black tracking-tight text-ink-900">{group.title}</p>
            <p className="font-body text-xs text-ink-400">
              {t('members', { count: group.members.length })}
              {(conv.onlineIds?.length ?? 0) > 0 && <span className="text-up"> · {t('onlineCount', { count: conv.onlineIds.length })}</span>}
              {inside.length > 0 && <span className="text-accent"> · {t('talkingNow', { count: inside.length })}</span>}
            </p>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onInvite} className="rounded-2xl bg-accent py-2.5 font-display text-sm font-bold text-black transition-transform active:scale-[0.98]">
            {t('inviteTitle')}
          </button>
          <button type="button" onClick={onMembers} className="rounded-2xl bg-white/[0.08] py-2.5 font-display text-sm font-bold text-ink-900 transition-transform active:scale-[0.98]">
            {t('membersButton')}
          </button>
        </div>
      </div>

      <div className={cn(tall ? '' : 'max-h-[48vh] overflow-y-auto', 'mt-4 pb-1')}>
        {/* Text channels */}
        <div className="flex items-center justify-between px-1">
          <p className="font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('textChannels')}</p>
          {isOwner && (
            <button type="button" onClick={onChannels} aria-label={t('addChannel')} className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 active:bg-white/10">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          )}
        </div>
        <ul className="mt-1 space-y-0.5">
          {channels
            .filter((c) => c.kind === 'text')
            .map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(c.id);
                    onClose();
                  }}
                  className={cn(row, 'relative', current === c.id ? 'bg-white/[0.08] text-ink-900' : 'text-ink-600')}
                >
                  {current === c.id && <span className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-accent" aria-hidden />}
                  <span className={cn('font-display text-lg font-bold leading-none', current === c.id ? 'text-accent' : 'text-ink-400')}>#</span>
                  <span className="truncate font-display text-[0.95rem] font-bold">{c.name}</span>
                </button>
              </li>
            ))}
        </ul>

        {/* Voice */}
        {voice && (
          <>
            <p className="mt-4 px-1 font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('voiceSection')}</p>
            <div className={cn('mt-1 rounded-2xl border p-2', inside.length > 0 ? 'border-accent/25 bg-accent/[0.06]' : 'border-white/[0.06] bg-white/[0.02]')}>
              <button
                type="button"
                onClick={() => {
                  onLounge();
                  onClose();
                }}
                disabled={inLounge}
                className={cn(row, 'text-ink-900')}
              >
                <SpeakerIcon className={inside.length > 0 ? 'text-accent' : 'text-ink-400'} />
                <span className="min-w-0 flex-1 truncate font-display text-[0.95rem] font-bold">{voice.name}</span>
                <span className={cn('rounded-full px-3 py-1 font-display text-xs font-bold', inLounge ? 'bg-white/10 text-ink-600' : 'bg-accent text-black')}>
                  {inLounge ? t('youreIn') : t('joinVoice')}
                </span>
              </button>
              {inside.length > 0 ? (
                <ul className="mt-1 space-y-1 pb-1 pl-9">
                  {inside.slice(0, 12).map((p) => {
                    const who = byId.get(p.userId);
                    return (
                      <li key={p.userId} className="flex items-center gap-2">
                        <DmAvatar name={who?.username ?? null} src={who?.avatarUrl ?? null} className={cn('h-6 w-6 text-[0.6rem]', !p.muted && 'ring-2 ring-accent/70')} />
                        <span className="truncate font-body text-sm text-ink-600">{who?.username ? `@${who.username}` : t('someone')}</span>
                        {p.muted && <span className="font-body text-[0.65rem] text-ink-400">🔇</span>}
                        {p.tracks.some((tr) => tr.kind === 'screen') && <span className="rounded bg-down/80 px-1 font-body text-[0.55rem] font-bold text-white">LIVE</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-3 pb-1.5 font-body text-xs text-ink-400">{t('loungeEmpty')}</p>
              )}
            </div>
          </>
        )}

        {/* Squad Wars (owner) */}
        {isOwner && onSquad && (
          <button type="button" onClick={onSquad} className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3 text-left active:bg-white/[0.06]">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(150deg,#FFF1B8,#F5C451_45%,#B07A1E)] text-base" aria-hidden>
              ⚔️
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold text-ink-900">{t('squadWars')}</span>
              <span className="block truncate font-body text-[0.7rem] text-ink-400">{t(`squad_${group.community?.visibility ?? 'private'}`)}</span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        )}

        {/* Members preview */}
        <button type="button" onClick={onMembers} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-3 text-left active:bg-white/[0.06]">
          <span className="flex -space-x-2">
            {group.members.slice(0, 5).map((p) => (
              <DmAvatar key={p.userId} name={p.username} src={p.avatarUrl} className="h-8 w-8 text-[0.65rem] ring-2 ring-bg" />
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate font-body text-sm text-ink-600">{t('members', { count: group.members.length })}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-400" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <button type="button" onClick={onLeave} className="mt-3 w-full rounded-2xl py-2.5 font-display text-sm font-bold text-down active:bg-down/10">
          {t('leaveCommunity')}
        </button>
      </div>
    </div>
  );
}

/** The community home as a sheet (phones; or tap the name on a small screen). */
export function CommunityHome({ open, ...props }: Parameters<typeof CommunityPanel>[0] & { open: boolean }) {
  return (
    <MobileDrawer open={open} onClose={props.onClose} title={props.conv.group!.title} desktop>
      <CommunityPanel {...props} />
    </MobileDrawer>
  );
}

/** Your communities as a rail of tiles on top of Messages (Discord's server list, sideways). */
export function CommunityRail({ items, onCreate }: { items: DmConversation[]; onCreate: () => void }) {
  const t = useTranslations('dm');
  const router = useRouter();
  return (
    <div className="mt-5">
      <p className="px-1 font-body text-[0.65rem] font-bold uppercase tracking-[0.14em] text-ink-400">{t('yourCommunities')}</p>
      <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {items.map((c) => (
          <button key={c.id} type="button" onClick={() => router.push(`/messages/${c.id}`)} className="flex w-16 shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95">
            <span className="relative">
              <CommunityAvatar title={c.group!.title} className={cn('h-14 w-14 text-base', c.unread > 0 && 'border-accent/60')} />
              {c.unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-bg bg-accent px-1 font-body text-[0.58rem] font-bold text-black">
                  {c.unread > 99 ? '99+' : c.unread}
                </span>
              )}
            </span>
            <span className={cn('w-full truncate text-center font-body text-[0.68rem]', c.unread > 0 ? 'font-semibold text-ink-900' : 'text-ink-400')}>{c.group!.title}</span>
          </button>
        ))}
        <button type="button" onClick={onCreate} className="flex w-16 shrink-0 flex-col items-center gap-1.5 transition-transform active:scale-95">
          <span className="flex h-14 w-14 items-center justify-center rounded-[30%] border border-dashed border-white/15 bg-white/[0.03] text-ink-400">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <span className="w-full truncate text-center font-body text-[0.68rem] text-ink-400">{t('newShort')}</span>
        </button>
      </div>
    </div>
  );
}

/** Owner: enter the community in Squad Wars — private (not ranked), invite-only (ranked, people
 *  ask to join) or public (ranked, anyone joins) — and its one-line pitch. */
export function SquadSettingsDrawer({ open, onClose, conv, onDone }: { open: boolean; onClose: () => void; conv: DmConversation; onDone: (c: DmConversation) => void }) {
  const t = useTranslations('dm');
  const current = conv.group?.community?.visibility ?? 'private';
  const [visibility, setVisibility] = useState<'private' | 'gated' | 'public'>(current);
  const [about, setAbout] = useState(conv.group?.community?.about ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setVisibility(conv.group?.community?.visibility ?? 'private');
    setAbout(conv.group?.community?.about ?? '');
  }, [open, conv]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onDone(await updateSquad(conv.id, { visibility, about: about.trim() }));
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const options = [
    { key: 'private', icon: '🔐' },
    { key: 'gated', icon: '🔒' },
    { key: 'public', icon: '🌐' },
  ] as const;

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('squadWars')} desktop>
      <p className="font-body text-sm text-ink-400">{t('squadIntro')}</p>
      <div className="mt-3 space-y-2" role="radiogroup">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={visibility === o.key}
            onClick={() => setVisibility(o.key)}
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors',
              visibility === o.key ? 'border-accent/40 bg-accent/[0.07]' : 'border-white/[0.06] bg-white/[0.02] active:bg-white/[0.05]',
            )}
          >
            <span className="text-lg" aria-hidden>
              {o.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-bold text-ink-900">{t(`squad_${o.key}`)}</span>
              <span className="block font-body text-[0.72rem] leading-snug text-ink-400">{t(`squad_${o.key}_body`)}</span>
            </span>
            <span className={cn('mt-1 h-4 w-4 shrink-0 rounded-full border-2', visibility === o.key ? 'border-accent bg-accent' : 'border-white/20')} aria-hidden />
          </button>
        ))}
      </div>
      <label className="mt-4 block font-body text-xs font-semibold text-ink-400">{t('squadAbout')}</label>
      <textarea
        value={about}
        onChange={(e) => setAbout(e.target.value.slice(0, 140))}
        rows={2}
        placeholder={t('squadAboutPlaceholder')}
        className="mt-1.5 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />
      <p className="mt-1 text-right font-body text-[0.65rem] text-ink-400">{about.length}/140</p>
      {error && <p className="mt-1 font-body text-xs font-semibold text-down">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void save()} className="mt-3 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40">
        {busy ? '…' : t('save')}
      </button>
    </MobileDrawer>
  );
}

export function SpeakerIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M11 5 6 9H2v6h4l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}
