import { fromDexScreener, fromGeckoTerminal, safeUrl, telegramUrlFromHandle, twitterUrlFromHandle } from './token-info.service';

describe('token info sanitizing', () => {
  it('only keeps well-formed https URLs, on the expected host when one is required', () => {
    expect(safeUrl('https://www.bonkcoin.com')).toBe('https://www.bonkcoin.com/');
    expect(safeUrl('http://insecure.example')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://user:pw@evil.example')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('https://discord.gg/abc', new Set(['discord.gg']))).toBe('https://discord.gg/abc');
    expect(safeUrl('https://discord.gg.evil.example/abc', new Set(['discord.gg']))).toBeNull();
  });

  it('builds X and Telegram links only from valid handles', () => {
    expect(twitterUrlFromHandle('bonk_inu')).toBe('https://x.com/bonk_inu');
    expect(twitterUrlFromHandle('@bonk_inu')).toBe('https://x.com/bonk_inu');
    expect(twitterUrlFromHandle('bad/handle')).toBeNull();
    expect(twitterUrlFromHandle(null)).toBeNull();
    expect(telegramUrlFromHandle('bonkcoin')).toBe('https://t.me/bonkcoin');
    expect(telegramUrlFromHandle('x')).toBeNull();
  });

  it('maps GeckoTerminal token info, dropping unsafe entries and HTML in the description', () => {
    const info = fromGeckoTerminal({
      websites: ['https://www.bonkcoin.com', 'javascript:alert(1)'],
      twitter_handle: 'bonk_inu',
      telegram_handle: null,
      discord_url: 'https://discord.gg/ubqvDDFUhf',
      description: '<p>Bonk is a   dog-themed memecoin.</p>',
    });
    expect(info).toEqual({
      websites: ['https://www.bonkcoin.com/'],
      twitterUrl: 'https://x.com/bonk_inu',
      telegramUrl: null,
      discordUrl: 'https://discord.gg/ubqvDDFUhf',
      description: 'Bonk is a dog-themed memecoin.',
      source: 'geckoterminal',
    });
  });

  it('maps DexScreener pair info, keeping socials only on their real hosts', () => {
    const info = fromDexScreener([
      { info: {} },
      {
        info: {
          websites: [{ url: 'https://www.bonkcoin.com' }],
          socials: [
            { type: 'twitter', url: 'https://twitter.com/bonk_inu' },
            { type: 'telegram', url: 'https://t-me.evil.example/x' },
          ],
        },
      },
    ]);
    expect(info.websites).toEqual(['https://www.bonkcoin.com/']);
    expect(info.twitterUrl).toBe('https://twitter.com/bonk_inu');
    expect(info.telegramUrl).toBeNull();
    expect(info.source).toBe('dexscreener');
  });
});
