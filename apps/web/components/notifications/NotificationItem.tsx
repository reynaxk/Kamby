import type { NotificationDto } from '@kamby/domain';
import { cn } from '@kamby/ui';
import Link from 'next/link';
import { formatCompactUsd, formatRelativeTime } from '@/lib/format';
import { useTranslations } from 'next-intl';
import { notificationCopy, notificationKindLabel } from './notificationCopy';

const KIND_COLOR: Record<NotificationDto['type'], string> = {
  FOLLOW: 'text-accent',
  LIKE: 'text-accent',
  FOLLOWED_TRADER_TRADE: 'text-up',
  WHALE_TRADE: 'text-up',
  TRENDING_TOKEN: 'text-accent',
  WATCHED_TOKEN_ACTIVITY: 'text-up',
  TRADE_CONFIRMED: 'text-up',
  TRADE_FAILED: 'text-down',
  PRICE_MOVE: 'text-accent',
  USDC_RECEIVED: 'text-up',
  DM_MESSAGE: 'text-accent',
  CALL_INCOMING: 'text-accent',
  LIVE_STARTED: 'text-down',
};

/** Each kind's own line icon (2026-10-15, the landing page's icon style) and its tint. */
const KIND_ICON: Record<NotificationDto['type'], { path: string; tile: string }> = {
  FOLLOW: { path: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 8v6M22 11h-6', tile: 'bg-accent/10 text-accent border-accent/20' },
  LIKE: { path: 'M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z', tile: 'bg-down/10 text-down border-down/20' },
  FOLLOWED_TRADER_TRADE: { path: 'M3 17l6-6 4 4 8-8M15 7h6v6', tile: 'bg-up/10 text-up border-up/20' },
  WHALE_TRADE: { path: 'M2 14c2.5 0 3.5-2 6-2s3.5 2 6 2 3.5-2 6-2M2 19c2.5 0 3.5-2 6-2s3.5 2 6 2 3.5-2 6-2M12 3v5', tile: 'bg-[#00E5FF]/10 text-[#00E5FF] border-[#00E5FF]/20' },
  TRENDING_TOKEN: { path: 'M12 3c1 3.5 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.5 1.5 1.5 2.5 3 2.5 0-3-1-5.5 0-8Z', tile: 'bg-warn/10 text-warn border-warn/20' },
  WATCHED_TOKEN_ACTIVITY: { path: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', tile: 'bg-accent/10 text-accent border-accent/20' },
  TRADE_CONFIRMED: { path: 'M20 6 9 17l-5-5', tile: 'bg-up/10 text-up border-up/20' },
  TRADE_FAILED: { path: 'M18 6 6 18M6 6l12 12', tile: 'bg-down/10 text-down border-down/20' },
  PRICE_MOVE: { path: 'M3 17l6-6 4 4 8-8M15 7h6v6', tile: 'bg-accent/10 text-accent border-accent/20' },
  USDC_RECEIVED: { path: 'm22 2-7 20-4-9-9-4ZM22 2 11 13', tile: 'bg-up/10 text-up border-up/20' },
  DM_MESSAGE: { path: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z', tile: 'bg-accent/10 text-accent border-accent/20' },
  LIVE_STARTED: { path: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.1 4.9a10 10 0 0 1 0 14.2M4.9 19.1a10 10 0 0 1 0-14.2', tile: 'bg-down/10 text-down border-down/20' },
  CALL_INCOMING: { path: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z', tile: 'bg-accent/10 text-accent border-accent/20' },
};

function KindIcon({ type, size = 18 }: { type: NotificationDto['type']; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={KIND_ICON[type].path} />
    </svg>
  );
}

/** The number worth seeing at a glance, on the right: money received, a trade's size, a move. */
function Figure({ n }: { n: NotificationDto }) {
  if (n.type === 'USDC_RECEIVED' && n.amountUsd !== null) return <span className="font-display text-base font-bold tabular-nums text-up">+{formatCompactUsd(n.amountUsd)}</span>;
  if (n.type === 'PRICE_MOVE' && n.pct !== null && n.pct !== undefined) {
    return <span className={cn('font-display text-sm font-bold tabular-nums', n.pct >= 0 ? 'text-up' : 'text-down')}>{n.pct >= 0 ? '+' : ''}{n.pct}%</span>;
  }
  if ((n.type === 'TRADE_CONFIRMED' || n.type === 'WHALE_TRADE' || n.type === 'FOLLOWED_TRADER_TRADE') && n.amountUsd !== null) {
    return <span className="font-display text-sm font-bold tabular-nums text-ink-900">{formatCompactUsd(n.amountUsd)}</span>;
  }
  return null;
}

/**
 * One notification row — shared by the bell dropdown and the full /notifications page. An
 * unread notification gets a subtle accent-tinted background and a small dot, never a loud
 * badge or animation (see docs/NOTIFICATIONS.md's "premium, subtle" UI bar). Clicking marks
 * it read and follows its deep link, when it has one.
 */
export function NotificationItem({
  notification,
  onOpen,
}: {
  notification: NotificationDto;
  onOpen: (n: NotificationDto) => void;
}) {
  const t = useTranslations('notif');
  const isUnread = notification.readAt === null;
  const content = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors',
        isUnread ? 'bg-accent/[0.06] hover:bg-accent/10' : 'hover:bg-surface-raised',
      )}
    >
      <Avatar notification={notification} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-[0.65rem] font-semibold uppercase tracking-wide',
              KIND_COLOR[notification.type],
            )}
          >
            {notificationKindLabel(notification.type, t)}
          </span>
          <time
            dateTime={notification.createdAt}
            title={new Date(notification.createdAt).toLocaleString('en-US')}
            className="font-mono text-[0.65rem] text-ink-400"
            suppressHydrationWarning
          >
            {formatRelativeTime(notification.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 truncate font-body text-sm text-ink-900">
          {notificationCopy(notification, t)}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        <Figure n={notification} />
        {isUnread && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>
    </div>
  );

  if (!notification.deepLink) {
    return (
      <button type="button" onClick={() => onOpen(notification)} className="block w-full text-left">
        {content}
      </button>
    );
  }

  return (
    <Link href={notification.deepLink} onClick={() => onOpen(notification)} className="block">
      {content}
    </Link>
  );
}

function Avatar({ notification }: { notification: NotificationDto }) {
  const kind = KIND_ICON[notification.type];
  const picture = notification.actor?.avatarUrl ?? (notification.actor ? null : notification.token?.logoUrl);
  const initials =
    (notification.actor?.displayName ? Array.from(notification.actor.displayName).slice(0, 2).join('').toUpperCase() : null) ??
    notification.actor?.address?.slice(2, 4)?.toUpperCase() ??
    null;
  // No person and no coin picture: the kind's own icon tile.
  if (!picture && !initials) {
    return (
      <span aria-hidden className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border', kind.tile)}>
        <KindIcon type={notification.type} />
      </span>
    );
  }
  return (
    <span aria-hidden className="relative h-10 w-10 shrink-0">
      {picture ? (
        // next/image needs every remote domain pre-configured — not workable for an arbitrary avatar URL.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt="" className="h-10 w-10 rounded-full object-cover" />
      ) : (
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-raised font-display text-xs font-bold text-accent">{initials}</span>
      )}
      <span className={cn('absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border bg-bg', kind.tile)}>
        <KindIcon type={notification.type} size={11} />
      </span>
    </span>
  );
}
