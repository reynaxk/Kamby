import { NEWS_SOURCES, matchNewsTickers } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { parseFeed } from './news-ingestion';

const decrypt = NEWS_SOURCES.find((s) => s.id === 'decrypt')!;
const now = Date.parse('2026-10-31T16:00:00Z');

const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Decrypt</title>
<item><title>Solana&amp;#039;s $BONK rallies as memecoins return</title>
<link>https://decrypt.co/1/bonk-rallies?utm_source=rss&amp;utm_medium=feed</link>
<pubDate>Sat, 31 Oct 2026 15:50:00 +0000</pubDate>
<description><![CDATA[<p>Traders piled in. <img src="https://px.example/track.gif" width="1" height="1"/><script>x()</script></p>]]></description></item>
<item><title>Off-site story</title><link>https://evil.example/x</link><pubDate>Sat, 31 Oct 2026 15:00:00 +0000</pubDate></item>
<item><title>Ancient story</title><link>https://decrypt.co/2</link><pubDate>Sat, 01 Aug 2026 15:00:00 +0000</pubDate></item>
</channel></rss>`;

describe('parseFeed', () => {
  it('cleans text, strips tracking, drops off-site and stale items', async () => {
    const items = await parseFeed(rss, decrypt, now);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      sourceId: 'decrypt',
      title: "Solana's $BONK rallies as memecoins return",
      summary: 'Traders piled in.',
      url: 'https://decrypt.co/1/bonk-rallies',
      publishedAt: '2026-10-31T15:50:00.000Z',
    });
    expect(items[0]!.id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('gives the same story the same id however it is punctuated', async () => {
    const a = await parseFeed(rss, decrypt, now);
    const b = await parseFeed(rss.replace("Solana&amp;#039;s $BONK rallies", 'SOLANA’S $BONK RALLIES'), decrypt, now);
    expect(a[0]!.id).toBe(b[0]!.id);
  });
});

describe('matchNewsTickers', () => {
  const symbols = (title: string, summary = '') => matchNewsTickers(title, summary).map((t) => t.symbol);

  it('matches cashtags, unambiguous tickers and names', () => {
    expect(symbols('Bitcoin tops $120K as $WIF and BONK rally')).toEqual(['BTC', 'BONK', 'WIF']);
    expect(symbols('Ethereum devs ship upgrade')).toEqual(['ETH']);
  });

  it('ignores ordinary words and copycat-prone lookalikes', () => {
    expect(symbols('Ray Dalio says uni students should read about bonk-style memes')).toEqual([]);
    expect(symbols('ETHENA launches new product')).toEqual([]);
  });

  it('caps at three tags, title first', () => {
    expect(symbols('BTC ETH SOL', 'BNB too')).toEqual(['BTC', 'ETH', 'SOL']);
  });
});
