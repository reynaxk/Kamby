'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NEWS_VERIFIED_TICKERS, type LiveRoom } from '@kamby/domain';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { LiveCoinPanel } from '@/components/live/LiveCoinPanel';
import { WidgetBoundary } from '@/components/ui-kit/WidgetBoundary';
import { cashtag } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';

export type FeedCoinRef = NonNullable<LiveRoom['coin']>;

const OpenCoinContext = createContext<((coin: FeedCoinRef) => void) | null>(null);

/** Opens a coin in place (chart + buy) — null outside a FeedCoinProvider. */
export function useOpenCoin(): ((coin: FeedCoinRef) => void) | null {
  return useContext(OpenCoinContext);
}

/**
 * Inline coins in the Feed (2026-10-31): tapping a coin in a post or a news card opens a sheet
 * with its live chart and buy panel (the same one as in a live stream) — no leaving the feed.
 */
export function FeedCoinProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('feed');
  const [coin, setCoin] = useState<FeedCoinRef | null>(null);
  const href = coin ? marketHref(coin.chainIdentifier, coin.tokenAddress) : null;
  return (
    <OpenCoinContext.Provider value={setCoin}>
      {children}
      <MobileDrawer open={coin !== null} onClose={() => setCoin(null)} title={coin ? cashtag(coin.symbol ?? '') : ''} desktop>
        {coin && (
          <div className="flex flex-col gap-3">
            <WidgetBoundary name="feed-coin">
              <LiveCoinPanel key={`${coin.chainIdentifier}:${coin.tokenAddress}`} coin={coin} />
            </WidgetBoundary>
            {href && (
              <Link href={href} onClick={() => setCoin(null)} className="text-center font-display text-sm font-bold text-accent hover:underline">
                {t('openCoin')}
              </Link>
            )}
          </div>
        )}
      </MobileDrawer>
    </OpenCoinContext.Provider>
  );
}

const VERIFIED_BY_SYMBOL = new Map(NEWS_VERIFIED_TICKERS.map((v) => [v.symbol, v]));

/** Exported for tests. A post's text split into plain parts and verified-coin cashtags ("$SOL"). */
export function splitCashtags(body: string): (string | FeedCoinRef)[] {
  const parts: (string | FeedCoinRef)[] = [];
  let last = 0;
  for (const m of body.matchAll(/\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) {
    const verified = VERIFIED_BY_SYMBOL.get(m[1]!.toUpperCase());
    if (!verified) continue;
    if (m.index! > last) parts.push(body.slice(last, m.index));
    parts.push({ chainIdentifier: verified.chainIdentifier, tokenAddress: verified.tokenAddress, symbol: verified.symbol, logoUrl: null });
    last = m.index! + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

/** A post's text with verified cashtags tappable (only Kamby's verified coins — never a lookalike). */
export function PostBody({ body, className }: { body: string; className?: string }) {
  const open = useOpenCoin();
  const parts = useMemo(() => splitCashtags(body), [body]);
  return (
    <p className={className}>
      {parts.map((part, i) =>
        typeof part === 'string' || !open ? (
          typeof part === 'string' ? part : cashtag(part.symbol ?? '')
        ) : (
          <button key={i} type="button" onClick={() => open(part)} className="font-semibold text-accent hover:underline">
            {cashtag(part.symbol ?? '')}
          </button>
        ),
      )}
    </p>
  );
}
