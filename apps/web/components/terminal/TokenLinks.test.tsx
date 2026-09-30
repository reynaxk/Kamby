import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TokenInfo } from '@kamby/domain';
import { TokenLinks } from './TokenLinks';

const info: TokenInfo = {
  websites: ['https://www.bonkcoin.com/'],
  twitterUrl: 'https://x.com/bonk_inu',
  telegramUrl: null,
  discordUrl: 'https://discord.gg/abc',
  description: 'Bonk is a dog-themed memecoin.',
  source: 'geckoterminal',
};

afterEach(() => vi.unstubAllGlobals());

describe('TokenLinks', () => {
  it("shows the coin's description, website and socials as safe new-tab links", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(info) }));
    render(<TokenLinks chain="solana" address="DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" />);

    const website = await screen.findByRole('link', { name: 'bonkcoin.com' });
    expect(website).toHaveAttribute('href', 'https://www.bonkcoin.com/');
    expect(website).toHaveAttribute('target', '_blank');
    expect(website).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(screen.getByRole('link', { name: 'X' })).toHaveAttribute('href', 'https://x.com/bonk_inu');
    expect(screen.getByRole('link', { name: 'Discord' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Telegram' })).not.toBeInTheDocument();
    expect(screen.getByText('Bonk is a dog-themed memecoin.')).toBeInTheDocument();
    expect(screen.getByText(/not verified by Kamby/)).toBeInTheDocument();
  });

  it('renders nothing (not even its card) when the coin has no links or description', async () => {
    const empty: TokenInfo = { ...info, websites: [], twitterUrl: null, discordUrl: null, description: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(empty) }));
    const { container } = render(<TokenLinks chain="base" address="0xaaaa000000000000000000000000000000000002" cardTitle="About $AAA" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
