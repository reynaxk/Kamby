import type { MetadataRoute } from 'next';

/** Account-scoped pages have nothing useful to index (they render a sign-in prompt for a
 *  crawler) — everything public, including every token page, stays crawlable. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/account', '/notifications', '/trades', '/watchlist', '/referrals'],
    },
    sitemap: 'https://kambesh.com/sitemap.xml',
  };
}
