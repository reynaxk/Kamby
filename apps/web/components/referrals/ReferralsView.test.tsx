import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferralSummaryDto } from '@kamby/domain';
import { ReferralsView } from './ReferralsView';

const { fetchMyReferralSummary } = vi.hoisted(() => ({ fetchMyReferralSummary: vi.fn() }));
vi.mock('@/lib/referrals-client', () => ({ fetchMyReferralSummary }));
// ShareButton has its own real behavior (native share vs copy-link panel) covered in its own
// test file — isolated here so this file only exercises ReferralsView's own logic.
vi.mock('@/components/social/ShareButton', () => ({ ShareButton: () => <button type="button">Share</button> }));

function stubClipboard(writeText: (text: string) => Promise<void>) {
  // userEvent.setup() installs its own navigator.clipboard stub — stubbing before setup()
  // gets silently overwritten, same real gotcha CopyAddressButton.test.tsx documents.
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function fakeSummary(overrides: Partial<ReferralSummaryDto> = {}): ReferralSummaryDto {
  return {
    referralCode: 'ABC123',
    referredCount: 4,
    earnedUsdcAmountRaw: '12500000',
    earnedUsdcAmountFormatted: '$12.50',
    ...overrides,
  };
}

describe('ReferralsView', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
  });

  it('shows a real error state, not a silent blank, when the fetch fails', async () => {
    fetchMyReferralSummary.mockRejectedValue(new Error('network error'));
    render(<ReferralsView />);

    expect(await screen.findByText("Couldn't load your referral info.")).toBeInTheDocument();
  });

  it('builds the real referral link from the current origin and the server-issued code', async () => {
    fetchMyReferralSummary.mockResolvedValue(fakeSummary({ referralCode: 'ABC123' }));
    render(<ReferralsView />);

    expect(await screen.findByText(`${window.location.origin}/?ref=ABC123`)).toBeInTheDocument();
  });

  it('shows the real referred count and earned amount from the server', async () => {
    fetchMyReferralSummary.mockResolvedValue(fakeSummary({ referredCount: 7, earnedUsdcAmountFormatted: '$42.00' }));
    render(<ReferralsView />);
    await screen.findByText('7');

    expect(screen.getByText('$42.00')).toBeInTheDocument();
  });

  it('writes the real referral link to the clipboard and flips to "Copied!" on click', async () => {
    fetchMyReferralSummary.mockResolvedValue(fakeSummary({ referralCode: 'XYZ789' }));
    const user = userEvent.setup();
    render(<ReferralsView />);
    await screen.findByText(`${window.location.origin}/?ref=XYZ789`);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?ref=XYZ789`);
    expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it(
    'reverts back to "Copy link" after the confirmation window elapses',
    async () => {
      // Real timers throughout — mixing fake timers with userEvent's own async scheduling
      // hung indefinitely in a past test (see CopyAddressButton.test.tsx's own note).
      fetchMyReferralSummary.mockResolvedValue(fakeSummary());
      const user = userEvent.setup();
      render(<ReferralsView />);
      await screen.findByText(/\/\?ref=/);
      stubClipboard(vi.fn().mockResolvedValue(undefined));

      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(await screen.findByRole('button', { name: 'Copied!' })).toBeInTheDocument();

      expect(await screen.findByRole('button', { name: 'Copy link' }, { timeout: 2500 })).toBeInTheDocument();
    },
    { timeout: 5000 },
  );

  it('never crashes and stays showing "Copy link" when clipboard access is denied', async () => {
    fetchMyReferralSummary.mockResolvedValue(fakeSummary());
    const user = userEvent.setup();
    render(<ReferralsView />);
    await screen.findByText(/\/\?ref=/);
    stubClipboard(vi.fn().mockRejectedValue(new Error('Clipboard permission denied')));

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });
});
