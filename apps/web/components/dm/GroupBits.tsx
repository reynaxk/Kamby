'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DM_LIMITS, type DmPerson, type DmSystem } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { addGroupMembers, createGroup } from '@/lib/dm-client';
import { authedFetch } from '@/lib/session-client';
import { friendlyError } from '@/lib/friendly-error';
import { DmAvatar } from './DmAvatar';

/** A group's picture: two of its people, overlapping. */
export function GroupAvatar({ members, meId, className }: { members: DmPerson[]; meId: string; className?: string }) {
  const others = members.filter((m) => m.userId !== meId);
  const [a, b] = [others[0] ?? members[0], others[1] ?? members[1]];
  return (
    <span className={cn('relative block h-12 w-12 shrink-0', className)} aria-hidden>
      <DmAvatar name={a?.username ?? null} src={a?.avatarUrl ?? null} className="absolute left-0 top-0 h-[70%] w-[70%] text-xs ring-2 ring-bg" />
      <DmAvatar name={b?.username ?? null} src={b?.avatarUrl ?? null} className="absolute bottom-0 right-0 h-[70%] w-[70%] text-xs ring-2 ring-bg" />
    </span>
  );
}

/** A group event line in the reader's language. */
export function useSystemText(): (s: DmSystem) => string {
  const t = useTranslations('dm');
  return (s) => {
    const actor = s.actor ? `@${s.actor}` : t('someone');
    const targets = s.targets.map((n) => `@${n}`).join(', ');
    switch (s.event) {
      case 'created':
        return t('sysCreated', { actor });
      case 'added':
        return t('sysAdded', { actor, targets });
      case 'removed':
        return t('sysRemoved', { actor, targets });
      case 'left':
        return t('sysLeft', { actor });
      case 'renamed':
        return t('sysRenamed', { actor, title: s.title ?? '' });
      case 'call': {
        if (!s.durationSec) return s.video ? t('sysMissedVideo') : t('sysMissedCall');
        const m = Math.floor(s.durationSec / 60);
        const length = m > 0 ? t('minutes', { m }) : t('seconds', { s: s.durationSec });
        return s.video ? t('sysVideoCall', { length }) : t('sysCall', { length });
      }
    }
  };
}

/** @names as chips — each one checked to exist before it's added. */
function PeoplePicker({ people, onChange, max }: { people: string[]; onChange: (p: string[]) => void; max: number }) {
  const t = useTranslations('dm');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function add() {
    const name = input.trim().replace(/^@/, '').toLowerCase();
    if (name.length < 3 || people.includes(name)) return;
    if (people.length >= max) return setError(t('groupFull', { max: DM_LIMITS.groupMaxMembers }));
    setChecking(true);
    setError(null);
    const res = await authedFetch(`/identity/users/${encodeURIComponent(name)}/recipient`).catch(() => null);
    setChecking(false);
    if (!res || res.status === 404) return setError(t('noSuchUser', { name }));
    onChange([...people, name]);
    setInput('');
  }

  return (
    <div>
      <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/30 p-1.5 pl-4 focus-within:border-accent">
        <span className="font-display text-base font-bold text-accent">@</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\s/g, '').slice(0, 21))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder={t('toPlaceholder')}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent py-2 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
        <button type="button" onClick={() => void add()} disabled={checking || input.trim().length < 3} className="rounded-xl bg-white/10 px-3 py-2 font-display text-xs font-bold text-ink-900 disabled:opacity-40">
          {checking ? '…' : t('add')}
        </button>
      </div>
      {error && <p className="mt-1.5 px-1 font-body text-xs text-down">{error}</p>}
      {people.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {people.map((p) => (
            <span key={p} className="flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/[0.08] py-1 pl-1 pr-2">
              <DmAvatar name={p} src={null} className="h-6 w-6 text-[0.6rem]" />
              <span className="font-display text-xs font-bold text-ink-900">@{p}</span>
              <button type="button" aria-label={t('remove')} onClick={() => onChange(people.filter((x) => x !== p))} className="ml-0.5 text-ink-400">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** "New group": a name and the people in it. */
export function NewGroupDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('dm');
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const chat = await createGroup(title.trim(), people);
      router.push(`/messages/${chat.id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <MobileDrawer open={open} onClose={onClose} title={t('newGroup')} desktop>
      <label className="block font-body text-xs font-semibold text-ink-400">{t('groupName')}</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, DM_LIMITS.groupTitleMax))}
        placeholder={t('groupNamePlaceholder')}
        className="mt-1.5 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-display text-base font-bold text-ink-900 placeholder:font-body placeholder:font-normal placeholder:text-ink-400 focus:border-accent focus:outline-none"
      />
      <label className="mt-4 block font-body text-xs font-semibold text-ink-400">{t('people')}</label>
      <div className="mt-1.5">
        <PeoplePicker people={people} onChange={setPeople} max={DM_LIMITS.groupMaxMembers - 1} />
      </div>
      <p className="mt-3 font-body text-xs text-ink-400">{t('groupInviteNote')}</p>
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
      <button
        type="button"
        onClick={() => void create()}
        disabled={busy || !title.trim() || people.length === 0}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? '…' : t('createGroup')}
      </button>
    </MobileDrawer>
  );
}

/** The owner's "Add people" for an existing group. */
export function AddPeopleDrawer({ open, onClose, id, room, onDone }: { open: boolean; onClose: () => void; id: string; room: number; onDone: () => void }) {
  const t = useTranslations('dm');
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    setError(null);
    try {
      await addGroupMembers(id, people);
      setPeople([]);
      onDone();
      onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <MobileDrawer open={open} onClose={onClose} title={t('addPeople')} desktop>
      <PeoplePicker people={people} onChange={setPeople} max={room} />
      {error && <p className="mt-2 font-body text-xs font-semibold text-down">{error}</p>}
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy || people.length === 0}
        className="mt-4 w-full rounded-2xl bg-accent py-3.5 font-display text-base font-bold text-black transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        {busy ? '…' : t('add')}
      </button>
    </MobileDrawer>
  );
}
