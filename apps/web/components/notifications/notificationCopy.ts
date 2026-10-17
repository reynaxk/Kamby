import type { NotificationDto } from '@kamby/domain';
import { formatCompactUsd, truncateAddress } from '@/lib/format';

/** next-intl's translator for the `notif` namespace (any `(key, values) => string`). */
type Translate = (key: string, values?: Record<string, string>) => string;

/**
 * Renders human copy from a notification's structured fields — never trusts a
 * server-composed sentence, since the API deliberately never sends one (see
 * docs/NOTIFICATIONS.md#data-model and NotificationDto in @kamby/domain). In the reader's
 * language since 2026-10-11 (messages/*.json → `notif`).
 */
export function notificationCopy(n: NotificationDto, t: Translate): string {
  const actor = n.actor?.displayName ?? (n.actor?.address ? truncateAddress(n.actor.address) : t('someone'));
  const symbol = n.token?.symbol ? `$${n.token.symbol.replace(/^\$+/, '')}` : null;
  const token = symbol ?? (n.token?.address ? truncateAddress(n.token.address) : t('aToken'));
  const amount = formatCompactUsd(n.amountUsd);
  const side = n.side === 'SELL' ? 'SELL' : 'BUY';
  const values = { actor, token, amount, pct: n.pct !== null && n.pct !== undefined ? `${Math.abs(n.pct)}%` : '' };

  switch (n.type) {
    case 'FOLLOW':
    case 'LIKE':
    case 'TRENDING_TOKEN':
    case 'TRADE_FAILED':
      return t(n.type, values);
    case 'FOLLOWED_TRADER_TRADE':
    case 'WHALE_TRADE':
    case 'WATCHED_TOKEN_ACTIVITY':
    case 'TRADE_CONFIRMED':
      return t(`${n.type}_${side}`, values);
    case 'PRICE_MOVE':
      return t((n.pct ?? 0) >= 0 ? 'PRICE_MOVE_UP' : 'PRICE_MOVE_DOWN', values);
    case 'USDC_RECEIVED':
      return t('USDC_RECEIVED', values);
    case 'DM_MESSAGE':
      return t('DM_MESSAGE', values);
  }
}

/** A short kind label — the same visual role as ActivityCard's "Bought"/"Sold" eyebrow. */
export function notificationKindLabel(type: NotificationDto['type'], t: Translate): string {
  return t(`kind_${type}`);
}
