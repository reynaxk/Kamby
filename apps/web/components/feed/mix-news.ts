import type { FeedPost, NewsItem } from '@kamby/domain';

const NEWS_EVERY = 4;

/** Exported for tests. Posts with a headline after every NEWS_EVERY of them (each headline once). */
export function mixNews(posts: FeedPost[], news: NewsItem[]): ({ post: FeedPost } | { news: NewsItem })[] {
  const out: ({ post: FeedPost } | { news: NewsItem })[] = [];
  let n = 0;
  posts.forEach((post, i) => {
    out.push({ post });
    if ((i + 1) % NEWS_EVERY === 0 && n < news.length) out.push({ news: news[n++]! });
  });
  // A quiet feed still shows a couple of headlines.
  if (posts.length < NEWS_EVERY) for (; n < Math.min(news.length, 2); n++) out.push({ news: news[n]! });
  return out;
}
