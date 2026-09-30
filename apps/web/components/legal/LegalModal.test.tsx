import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

describe('LegalModal', () => {
  async function load(confirmed: boolean) {
    vi.resetModules();
    vi.doMock('@/lib/legal', () => ({
      LEGAL_DETAILS_CONFIRMED: confirmed,
      LEGAL_LAST_UPDATED: '2026-09-29',
      LEGAL_ENTITY: 'Kamby Test Ltd',
      LEGAL_CONTACT_EMAIL: 'legal@example.com',
    }));
    return import('./LegalModal');
  }

  it('shows the requested document, switches between Terms and Privacy, and closes on Escape', async () => {
    const { LegalModal } = await load(true);
    const onClose = vi.fn();
    render(<LegalModal open initialDocument="privacy" onClose={onClose} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open full page' })).toHaveAttribute('href', '/privacy');

    await userEvent.click(screen.getByRole('tab', { name: 'Terms of Service' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getByText(/operated by Kamby Test Ltd/)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('marks itself a draft while operator details are unconfirmed', async () => {
    const { LegalModal } = await load(false);
    render(<LegalModal open onClose={() => {}} />);
    expect(screen.getByText(/Draft — operator details/)).toBeInTheDocument();
  });

  it('renders nothing when closed', async () => {
    const { LegalModal } = await load(true);
    render(<LegalModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('LegalAgreementNote', () => {
  async function load(confirmed: boolean) {
    vi.resetModules();
    vi.doMock('@/lib/legal', () => ({
      LEGAL_DETAILS_CONFIRMED: confirmed,
      LEGAL_LAST_UPDATED: '2026-09-29',
      LEGAL_ENTITY: 'Kamby Test Ltd',
      LEGAL_CONTACT_EMAIL: 'legal@example.com',
    }));
    return import('./LegalAgreementNote');
  }

  it('never links to terms that are not published yet', async () => {
    const { LegalAgreementNote } = await load(false);
    const { container } = render(<LegalAgreementNote />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the matching document in a modal once published', async () => {
    const { LegalAgreementNote } = await load(true);
    render(<LegalAgreementNote />);

    expect(screen.getByText(/By signing in, you agree to/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Privacy Policy' })).toBeInTheDocument();
  });
});
