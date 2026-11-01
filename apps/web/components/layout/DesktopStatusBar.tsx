'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, History, Star, Wallet } from 'lucide-react';
import type { CryptoPrice, MarketFeedEvents } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { subscribeToMarketFeeds } from '@/lib/market-feeds';
import type { RealtimeStatus } from '@/lib/social-client';
import { formatPercent } from '@/lib/format';
import { showsDesktopSideNav } from './DesktopSideNav';

const MAJORS = ['SOL', 'ETH', 'BNB', 'BTC'] as const;

/**
 * The strip along the bottom on computers (2026-11-01, like GMGN's): your holdings, trades,
 * watchlist and notifications one click away, the majors' live prices, and whether the live data
 * stream is connected. From lg up; it takes the coin ticker's place there.
 */
export function DesktopStatusBar() {
  const pathname = usePathname() ?? '/';
  const t = useTranslations('statusBar');
  const tNav = useTranslations('nav');
  const tL = useTranslations('labels');
  const tY = useTranslations('you');
  const [prices, setPrices] = useState<CryptoPrice[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const shown = showsDesktopSideNav(pathname);

  useEffect(() => {
    if (!shown) return;
    return subscribeToMarketFeeds((type, data) => {
      if (type === 'crypto') setPrices((data as MarketFeedEvents['crypto']).prices);
    }, setStatus);
  }, [shown]);

  // Pages leave room at the bottom for it (--ticker-h, see globals.css).
  useEffect(() => {
    document.documentElement.classList.toggle('kamby-statusbar-on', shown);
    return () => document.documentElement.classList.remove('kamby-statusbar-on');
  }, [shown]);

  if (!shown) return null;
  const live = status === 'live';
  const links = [
    { href: '/account', label: tY('holdings'), icon: <Wallet /> },
    { href: '/trades', label: tL('menu_trades'), icon: <History /> },
    { href: '/explore?tab=watchlist', label: tNav('watchlist'), icon: <Star /> },
    { href: '/notifications', label: tL('menu_notifications'), icon: <Bell /> },
  ];

  return (
    <div className="kamby-void fixed inset-x-0 bottom-0 z-40 hidden h-9 items-center gap-1 border-t border-line bg-bg/95 px-3 lg:flex">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-lg px-2 font-display text-[0.75rem] font-bold transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5',
            pathname === l.href ? 'text-accent' : 'text-ink-600 hover:bg-surface hover:text-ink-900',
          )}
        >
          {l.icon}
          {l.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-4">
        {MAJORS.map((symbol) => {
          const p = prices.find((x) => x.symbol === symbol);
          if (!p) return null;
          const up = (p.change24hPct ?? 0) >= 0;
          return (
            <span key={symbol} className="flex items-center gap-1.5 font-mono text-[0.72rem] tabular-nums">
              <span className="font-bold text-ink-600">{symbol}</span>
              <span className="text-ink-900">${p.priceUsd >= 1000 ? Math.round(p.priceUsd).toLocaleString('en-US') : p.priceUsd.toFixed(2)}</span>
              {p.change24hPct !== null && <span className={up ? 'text-up' : 'text-down'}>{formatPercent(p.change24hPct)}</span>}
            </span>
          );
        })}
        <span className="flex items-center gap-1.5 border-l border-line pl-4 font-mono text-[0.7rem] text-ink-400">
          <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-up' : 'animate-pulse bg-[#FBBF24]')} />
          {live ? t('live') : t('connecting')}
        </span>
        <Link href="/terms" className="font-mono text-[0.68rem] text-ink-400 hover:text-ink-600">
          Terms
        </Link>
        <Link href="/privacy" className="font-mono text-[0.68rem] text-ink-400 hover:text-ink-600">
          Privacy
        </Link>
      </div>
    </div>
  );
}
