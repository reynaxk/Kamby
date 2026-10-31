'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NewsFeed } from './NewsFeed';

/** The home screen's three newest headlines, with a way into /news (the phone's only door to it). */
export function HomeNews() {
  const t = useTranslations('news');
  return (
    <section className="mt-5 px-4 md:px-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-base font-bold text-ink-900">{t('title')}</h2>
        <Link href="/news" className="font-body text-xs font-semibold text-accent hover:underline">
          {t('seeAll')}
        </Link>
      </div>
      <NewsFeed limit={3} fixed compact hideWhenEmpty />
    </section>
  );
}
