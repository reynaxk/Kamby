import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/market/MarketHeader', () => ({ MarketHeader: () => <header /> }));

describe('LegalPage', () => {
  it('shows a visible draft banner while operator details are unconfirmed', async () => {
    vi.resetModules();
    vi.doMock('@/lib/legal', () => ({ LEGAL_DETAILS_CONFIRMED: false, LEGAL_LAST_UPDATED: '2026-09-29' }));
    const { LegalPage } = await import('./LegalPage');
    render(<LegalPage title="Terms">body</LegalPage>);
    expect(screen.getByText(/Draft — operator details/)).toBeInTheDocument();
  });

  it('drops the banner once details are confirmed', async () => {
    vi.resetModules();
    vi.doMock('@/lib/legal', () => ({ LEGAL_DETAILS_CONFIRMED: true, LEGAL_LAST_UPDATED: '2026-09-29' }));
    const { LegalPage } = await import('./LegalPage');
    render(<LegalPage title="Terms">body</LegalPage>);
    expect(screen.queryByText(/Draft — operator details/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Terms' })).toBeInTheDocument();
  });
});
