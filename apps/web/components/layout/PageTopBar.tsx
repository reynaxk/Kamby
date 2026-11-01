'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bell, Search } from 'lucide-react';

/** A phone page's top row (2026-11-01, Trenches / Trending): the K, the page's name, search and
 *  notifications — search left the tab bar when Trenches and Trending moved in. */
export function PageTopBar({ title }: { title: string }) {
  const t = useTranslations('nav');
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 bg-bg/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:hidden">
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 font-display text-base font-black text-accent">K</span>
      <h1 className="min-w-0 flex-1 truncate font-display text-xl font-black tracking-tight text-ink-900">{title}</h1>
      <Link href="/search" aria-label={t('search')} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-ink-600 active:bg-white/[0.12]">
        <Search className="h-5 w-5" aria-hidden />
      </Link>
      <Link href="/notifications" aria-label="Notifications" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-ink-600 active:bg-white/[0.12]">
        <Bell className="h-5 w-5" aria-hidden />
      </Link>
    </header>
  );
}
