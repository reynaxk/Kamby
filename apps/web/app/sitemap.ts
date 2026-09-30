import type { MetadataRoute } from 'next';
import { fetchDiscoverMarkets } from '@/lib/market-api';
import { marketHref } from '@/lib/solana-links';

const SITE = 'https://kambesh.com';

// Regenerated at most hourly — the market list changes slowly, and crawlers don't need
// fresher than that.
export const revalidate = 3600;

/** Public pages plus every listed market's own page. An API outage still yields the static
 *  pages rather than failing the whole sitemap. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: 'always', priority: 1 },
    { url: `${SITE}/leaderboard`, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${SITE}/solana`, changeFrequency: 'daily', priority: 0.6 },
  ];
  const markets = await fetchDiscoverMarkets({ sort: 'score', limit: 100 }).catch(() => []);
  const marketPages = markets.flatMap((m) => {
    const href = marketHref(m.chainIdentifier, m.tokenAddress);
    return href ? [{ url: `${SITE}${href}`, changeFrequency: 'hourly' as const, priority: 0.7 }] : [];
  });
  return [...staticPages, ...marketPages];
}
