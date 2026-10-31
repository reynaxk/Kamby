import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { LiveRoom, NewsItem } from '@kamby/domain';
import { NewsSourceMark } from '@/components/news/NewsCard';

/**
 * "Right now" under the coin ticker (2026-10-31): who's live on Kamby and the latest crypto
 * headlines drifting by — all real (the same feeds the app uses), and each part simply absent
 * when there's nothing to show. Never a made-up Kamby total.
 */
export async function LandingPulse({ news, rooms }: { news: NewsItem[]; rooms: LiveRoom[] }) {
  const t = await getTranslations('landing');
  const headlines = news.slice(0, 10);
  const viewers = rooms.reduce((sum, r) => sum + r.viewers, 0);
  if (headlines.length < 3 && rooms.length === 0) return null;

  const row = (copy: string) =>
    headlines.map((item) => (
      <a
        key={`${copy}:${item.id}`}
        href={item.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        tabIndex={copy === 'b' ? -1 : undefined}
        className="flex max-w-[26rem] shrink-0 items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.015] py-2 pl-2.5 pr-3.5 transition-colors hover:border-white/15"
      >
        <NewsSourceMark sourceId={item.sourceId} className="shrink-0 [&>span:last-child]:hidden" />
        <span className="truncate font-body text-[0.8rem] text-white/75">{item.title}</span>
        {item.tokens[0] && <span className="shrink-0 font-mono text-[0.7rem] font-semibold text-[#00FF87]">${item.tokens[0].symbol}</span>}
      </a>
    ));

  return (
    <div className="mt-3 flex items-center gap-3 px-1.5">
      {rooms.length > 0 && (
        <Link
          href="/live"
          className="ml-3.5 flex shrink-0 items-center gap-2 rounded-2xl border border-[#FF3B69]/30 bg-[#FF3B69]/[0.08] px-3.5 py-2 font-display text-xs font-bold text-white"
        >
          <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-[#FF3B69]" />
          {t('pulseLive', { count: rooms.length, viewers })}
        </Link>
      )}
      {headlines.length >= 3 && (
        <div className="kamby-marquee-mask relative min-w-0 flex-1 overflow-hidden">
          <span className="sr-only">{t('pulseNews')}</span>
          {/* Same seamless loop as the coin ticker, slower and the other way. */}
          <div className="kamby-marquee flex w-max gap-3 [animation-direction:reverse] [animation-duration:90s]">
            {row('a')}
            <div aria-hidden className="flex gap-3">
              {row('b')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
