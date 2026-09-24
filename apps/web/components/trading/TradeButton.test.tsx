import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TradeButton, type TradeButtonProps } from './TradeButton';

// TradeModal and TradePanel both have their own separate concerns — TradePanel especially is
// real trading-write-path territory this session's ground rules keep untouched. Mocked here
// so this file only exercises TradeButton's own thin orchestration: open/closed state, label
// defaulting, and prop wiring.
vi.mock('./TradeModal', () => ({
  TradeModal: ({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) =>
    open ? (
      <div>
        <button type="button" onClick={onClose}>
          Close modal
        </button>
        {children}
      </div>
    ) : null,
}));
vi.mock('./TradePanel', () => ({
  TradePanel: ({
    chainId,
    tokenAddress,
    initialSide,
    onClose,
  }: {
    chainId: number;
    tokenAddress: string;
    initialSide?: string;
    onClose: () => void;
  }) => (
    <div>
      <p>
        TradePanel: {tokenAddress} on {chainId} ({initialSide ?? 'no-side'})
      </p>
      <button type="button" onClick={onClose}>
        Panel close
      </button>
    </div>
  ),
}));

const baseProps: TradeButtonProps = {
  chainId: 8453,
  tokenAddress: '0xaaa',
  tokenSymbol: 'FOO',
  tokenDecimals: 18,
  quoteTokenAddress: '0xquote',
  quoteTokenSymbol: 'WETH',
  quoteTokenDecimals: 18,
};

describe('TradeButton', () => {
  it('labels itself "Trade" by default, with no side given', () => {
    render(<TradeButton {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Trade' })).toBeInTheDocument();
  });

  it('labels itself "Buy" for a real BUY side', () => {
    render(<TradeButton {...baseProps} side="BUY" />);
    expect(screen.getByRole('button', { name: 'Buy' })).toBeInTheDocument();
  });

  it('labels itself "Sell" for a real SELL side', () => {
    render(<TradeButton {...baseProps} side="SELL" />);
    expect(screen.getByRole('button', { name: 'Sell' })).toBeInTheDocument();
  });

  it('prefers an explicit label over the side-based default', () => {
    render(<TradeButton {...baseProps} side="BUY" label="Ape in" />);
    expect(screen.getByRole('button', { name: 'Ape in' })).toBeInTheDocument();
  });

  it('starts with the modal closed', () => {
    render(<TradeButton {...baseProps} />);
    expect(screen.queryByText(/TradePanel:/)).not.toBeInTheDocument();
  });

  it('opens the modal, with the real TradePanel wired to the given chain and token, on click', async () => {
    const user = userEvent.setup();
    render(<TradeButton {...baseProps} chainId={56} tokenAddress="0xbbb" side="SELL" />);

    await user.click(screen.getByRole('button', { name: 'Sell' }));

    expect(screen.getByText('TradePanel: 0xbbb on 56 (SELL)')).toBeInTheDocument();
  });

  it("closes the modal when TradeModal's own close is triggered", async () => {
    const user = userEvent.setup();
    render(<TradeButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Trade' }));
    expect(screen.getByText(/TradePanel:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close modal' }));

    expect(screen.queryByText(/TradePanel:/)).not.toBeInTheDocument();
  });

  it("closes the modal when TradePanel's own onClose fires (e.g. after a completed trade)", async () => {
    const user = userEvent.setup();
    render(<TradeButton {...baseProps} />);
    await user.click(screen.getByRole('button', { name: 'Trade' }));
    expect(screen.getByText(/TradePanel:/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Panel close' }));

    expect(screen.queryByText(/TradePanel:/)).not.toBeInTheDocument();
  });
});
