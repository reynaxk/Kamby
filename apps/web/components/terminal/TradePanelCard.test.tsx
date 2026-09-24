import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TradePanelCard, IN_FLIGHT_STEPS } from './TradePanelCard';
import type { TradePanelStep } from '@/components/trading/TradePanel';

// TradePanel owns the real trading write-path (signing, quoting, fees) this session's ground
// rules keep untouched. Mocked here — with buttons to simulate every real step a trade can
// reach — so this file only exercises TradePanelCard's own thin wrapper logic: the glow
// class and the dual (internal + caller) onStepChange fan-out.
vi.mock('@/components/trading/TradePanel', () => ({
  TradePanel: ({ onStepChange }: { onStepChange: (step: TradePanelStep) => void }) => (
    <div>
      {(['form', 'review', 'approving', 'signing', 'submitted', 'pending', 'confirmed', 'failed'] as const).map((step) => (
        <button key={step} type="button" onClick={() => onStepChange(step)}>
          Go to {step}
        </button>
      ))}
    </div>
  ),
}));

const baseProps = {
  chainId: 8453,
  tokenAddress: '0xaaa',
  tokenSymbol: 'FOO',
  tokenDecimals: 18,
  quoteTokenAddress: '0xquote',
  quoteTokenSymbol: 'WETH',
  quoteTokenDecimals: 18,
};

describe('TradePanelCard', () => {
  it('exports the real set of in-flight steps used to decide the glow', () => {
    expect([...IN_FLIGHT_STEPS].sort()).toEqual(['approving', 'pending', 'review', 'signing'].sort());
  });

  it('never glows while the panel is on the idle form step', () => {
    const { container } = render(<TradePanelCard {...baseProps} />);
    expect(container.querySelector('.shadow-glow-accent')).not.toBeInTheDocument();
  });

  it.each(['review', 'approving', 'signing', 'pending'] as const)(
    'glows once the panel reports the real in-flight step "%s"',
    async (step) => {
      const user = userEvent.setup();
      const { container } = render(<TradePanelCard {...baseProps} />);

      await user.click(screen.getByRole('button', { name: `Go to ${step}` }));

      expect(container.querySelector('.shadow-glow-accent')).toBeInTheDocument();
    },
  );

  it.each(['submitted', 'confirmed', 'failed'] as const)(
    'never glows for the real terminal-but-not-in-flight step "%s"',
    async (step) => {
      const user = userEvent.setup();
      const { container } = render(<TradePanelCard {...baseProps} />);

      await user.click(screen.getByRole('button', { name: `Go to ${step}` }));

      expect(container.querySelector('.shadow-glow-accent')).not.toBeInTheDocument();
    },
  );

  it('stops glowing once a trade leaves an in-flight step', async () => {
    const user = userEvent.setup();
    const { container } = render(<TradePanelCard {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Go to review' }));
    expect(container.querySelector('.shadow-glow-accent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go to confirmed' }));

    expect(container.querySelector('.shadow-glow-accent')).not.toBeInTheDocument();
  });

  it('calls a real caller-supplied onStepChange for every step transition, never instead of its own internal tracking', async () => {
    const onStepChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<TradePanelCard {...baseProps} onStepChange={onStepChange} />);

    await user.click(screen.getByRole('button', { name: 'Go to review' }));

    expect(onStepChange).toHaveBeenCalledWith('review');
    expect(container.querySelector('.shadow-glow-accent')).toBeInTheDocument(); // internal tracking still fired too
  });

  it('never crashes when no onStepChange prop was given at all', async () => {
    const user = userEvent.setup();
    render(<TradePanelCard {...baseProps} />);

    await expect(user.click(screen.getByRole('button', { name: 'Go to review' }))).resolves.not.toThrow();
  });
});
