'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { ArrowUp } from 'lucide-react';
import { containsLink, PULSE_LIMITS, type PulseMessage } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { fetchMyProfile } from '@/lib/profile-client';
import { fetchPulse, postPulse, PULSE_STREAM_URL } from '@/lib/pulse-client';
import { openResilientEventSource } from '@/lib/resilient-event-source';
import { hasStoredSession } from '@/lib/session-client';
import type { RealtimeStatus } from '@/lib/social-client';

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** $SYMBOL mentions lit up in Kamby green; everything else plain text (no links, ever). */
function Body({ text }: { text: string }) {
  const parts = text.split(/(\$[A-Za-z][A-Za-z0-9]{0,14})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^\$[A-Za-z]/.test(part) ? (
          <span key={i} className="font-semibold text-accent">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Pulse — Kamby's worldwide chat (2026-10-11; replaced the Feed tab). Live for everyone; the
 * newest message at the bottom, like any chat. Posting needs an account with a username, and
 * links are refused (they're how trading chats get scammed) — the API enforces the same rules.
 */
export function PulseChat({ className }: { className?: string }) {
  const t = useTranslations('pulse');
  const tAuth = useTranslations('auth');
  const { ready, authenticated, login } = usePrivy();
  const [messages, setMessages] = useState<PulseMessage[] | null>(null);
  const [older, setOlder] = useState<string | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const [username, setUsername] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // First page + live stream.
  useEffect(() => {
    let cancelled = false;
    fetchPulse()
      .then((page) => {
        if (cancelled) return;
        setMessages([...page.items].reverse());
        setOlder(page.nextBefore);
      })
      .catch(() => !cancelled && setMessages([]));
    const close = openResilientEventSource(
      PULSE_STREAM_URL,
      {
        message: (data) => {
          try {
            const m = JSON.parse(data) as PulseMessage;
            setMessages((prev) => (prev && !prev.some((p) => p.id === m.id) ? [...prev, m] : prev));
          } catch {
            // ignore a malformed event
          }
        },
      },
      setStatus,
    );
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelled = true;
      close();
      clearInterval(tick);
    };
  }, []);

  // Who's writing (a username is needed to post).
  useEffect(() => {
    if (!authenticated || !hasStoredSession()) {
      setUsername(null);
      return;
    }
    fetchMyProfile()
      .then((p) => setUsername(p.username))
      .catch(() => setUsername(null));
  }, [authenticated]);

  // Keep the view on the newest message unless the reader scrolled up to read history.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function loadOlder() {
    if (!older) return;
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    const page = await fetchPulse(older).catch(() => null);
    if (!page) return;
    stickToBottom.current = false;
    setMessages((prev) => [...[...page.items].reverse(), ...(prev ?? [])]);
    setOlder(page.nextBefore);
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before;
    });
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    if (containsLink(body)) {
      setError(t('noLinks'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const m = await postPulse(body);
      stickToBottom.current = true;
      setMessages((prev) => (prev && !prev.some((p) => p.id === m.id) ? [...prev, m] : prev));
      setDraft('');
    } catch (e) {
      const status = (e as { status?: number }).status;
      setError(status === 429 ? t('slowDown') : status === 403 ? t('needUsername') : status === 400 ? (e as Error).message : t('sendFailed'));
    } finally {
      setSending(false);
    }
  }

  const left = PULSE_LIMITS.maxLength - draft.length;

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex items-center gap-2 px-4 py-2">
        <span className={cn('h-2 w-2 rounded-full', status === 'live' ? 'animate-pulse bg-accent' : 'bg-ink-400')} aria-hidden />
        <p className="font-body text-xs text-ink-400">{status === 'live' ? t('live') : t('connecting')}</p>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (el.scrollTop < 40 && older) void loadOlder();
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4"
      >
        {messages === null ? (
          <p className="py-8 text-center font-body text-sm text-ink-400">…</p>
        ) : messages.length === 0 ? (
          <p className="py-10 text-center font-body text-sm text-ink-400">{t('empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3 py-2">
            {messages.map((m) => {
              const name = m.author.username ? `@${m.author.username}` : t('trader');
              const avatar = (
                <TokenAvatar src={m.author.avatarUrl} seed={m.author.address ?? m.id} label={m.author.username ?? 'K'} className="h-8 w-8 shrink-0 text-xs" />
              );
              return (
                <li key={m.id} className="flex items-start gap-2.5">
                  {m.author.address ? <Link href={`/trader/${m.author.address}`}>{avatar}</Link> : avatar}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-baseline gap-2">
                      <span className="truncate font-display text-sm font-semibold text-ink-900">{name}</span>
                      <span className="shrink-0 font-body text-[0.7rem] text-ink-400">{ago(m.createdAt, now)}</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words font-body text-sm text-ink-700">
                      <Body text={m.body} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* On phones the floating tab bar sits over the bottom edge — keep the composer above it. */}
      <div className="border-t border-white/5 px-3 pb-2 pt-2 max-md:pb-[calc(env(safe-area-inset-bottom)+5rem)]">
        {!ready ? null : !authenticated ? (
          <button type="button" onClick={() => login()} className="h-11 w-full rounded-2xl bg-accent font-display text-sm font-bold text-black">
            {tAuth('signIn')} — {t('toChat')}
          </button>
        ) : username === undefined ? null : !username ? (
          <Link href="/account#profile" className="flex h-11 w-full items-center justify-center rounded-2xl bg-surface-raised font-display text-sm font-semibold text-ink-900">
            {t('setUsername')}
          </Link>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value.slice(0, PULSE_LIMITS.maxLength));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={t('placeholder')}
                aria-label={t('placeholder')}
                className="max-h-28 min-h-[2.75rem] flex-1 resize-none rounded-2xl bg-surface-raised px-4 py-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-accent/60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label={t('send')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-black transition-transform active:scale-95 disabled:opacity-40"
              >
                <ArrowUp className="h-5 w-5" aria-hidden />
              </button>
            </form>
            <p className={cn('mt-1 px-1 font-body text-[0.7rem]', error ? 'text-down' : 'text-ink-400')}>
              {error ?? (draft.length > PULSE_LIMITS.maxLength - 40 ? t('charsLeft', { n: String(left) }) : t('rules'))}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
