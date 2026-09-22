import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TerminalLeftRail } from './TerminalLeftRail';

vi.mock('./TrenchesPanel', () => ({ TrenchesPanel: () => <div data-testid="trenches-panel" /> }));
vi.mock('@/components/discovery/TradersSidebar', () => ({ TradersSidebar: () => <div data-testid="traders-sidebar" /> }));

describe('TerminalLeftRail', () => {
  it('shows Trenches by default — no chain-specific data assumed until the user asks for something else', () => {
    render(<TerminalLeftRail />);
    expect(screen.getByTestId('trenches-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('traders-sidebar')).not.toBeInTheDocument();
  });

  it('switches to Traders on click, and back to Trenches', async () => {
    const user = userEvent.setup();
    render(<TerminalLeftRail />);

    await user.click(screen.getByRole('button', { name: 'Traders' }));
    expect(screen.getByTestId('traders-sidebar')).toBeInTheDocument();
    expect(screen.queryByTestId('trenches-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trenches' }));
    expect(screen.getByTestId('trenches-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('traders-sidebar')).not.toBeInTheDocument();
  });
});
