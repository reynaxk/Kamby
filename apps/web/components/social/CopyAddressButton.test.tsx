import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyAddressButton } from './CopyAddressButton';

const ADDRESS = '0x1234567890123456789012345678901234567890';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  // userEvent.setup() installs its own navigator.clipboard stub — stubbing before setup()
  // gets silently overwritten by it, so callers must stub AFTER setup(), not before (the
  // same real gotcha ShareButton.test.tsx already documents for this exact API).
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('CopyAddressButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('shows "Copy" initially, with the full address available via the title attribute', () => {
    render(<CopyAddressButton address={ADDRESS} />);
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button).toHaveAttribute('title', ADDRESS);
  });

  it('writes the real address to the clipboard and flips to "Copied" on click', async () => {
    const user = userEvent.setup();
    render(<CopyAddressButton address={ADDRESS} />);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it(
    'reverts back to "Copy" after the confirmation window elapses',
    async () => {
      // Real timers throughout, not fake ones — mixing vi.useFakeTimers() with
      // userEvent.click()'s own internal async scheduling hung indefinitely in an earlier
      // draft of this test (and left fake timers active afterward, breaking the *next*
      // test too, since the hang prevented a try/finally cleanup from ever running). A
      // real ~1.5s wait here is a small, worthwhile price for a test that's actually
      // reliable.
      const user = userEvent.setup();
      render(<CopyAddressButton address={ADDRESS} />);
      stubClipboard(vi.fn().mockResolvedValue(undefined));

      await user.click(screen.getByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();

      expect(await screen.findByRole('button', { name: 'Copy' }, { timeout: 2500 })).toBeInTheDocument();
    },
    { timeout: 5000 },
  );

  it('never crashes and stays showing "Copy" when clipboard access is denied', async () => {
    const user = userEvent.setup();
    render(<CopyAddressButton address={ADDRESS} />);
    stubClipboard(vi.fn().mockRejectedValue(new Error('Clipboard permission denied')));

    await user.click(screen.getByRole('button', { name: 'Copy' }));

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
