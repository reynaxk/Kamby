import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SolanaTradeQuoteDto } from '@kamby/domain';
import { SolanaQuoteSummary } from './SolanaQuoteSummary';

function baseQuote(overrides: Partial<SolanaTradeQuoteDto> = {}): SolanaTradeQuoteDto {
  return {
    id: 'quote-1',
    side: 'BUY',
    inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    outputMint: 'So11111111111111111111111111111111111111112',
    inputAmountRaw: '10000000',
    outputAmountRaw: '98600000',
    minOutputAmountRaw: '98100000',
    priceImpactBps: 22,
    platformFeeBps: 50,
    platformFeeAmountRaw: '50000',
    unsignedTxBase64: 'base64',
    expiresAt: '2026-01-01T00:00:30.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SolanaQuoteSummary', () => {
  it('shows a BUY trade in USDC in, raw units out', () => {
    render(<SolanaQuoteSummary quote={baseQuote()} />);

    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('$10')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('98600000 raw units')).toBeInTheDocument();
    expect(screen.getByText('Minimum received')).toBeInTheDocument();
    expect(screen.getByText('98100000 raw units')).toBeInTheDocument();
    expect(screen.getByText('0.22%')).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument(); // platformFeeAmountRaw '50000' -> $0.05
    expect(screen.getByText('Jupiter')).toBeInTheDocument();
  });

  it('flips a SELL trade to raw units in, USDC out — never mislabels which side is which', () => {
    render(
      <SolanaQuoteSummary
        quote={baseQuote({ side: 'SELL', inputAmountRaw: '500000000', outputAmountRaw: '9500000', minOutputAmountRaw: '9400000' })}
      />,
    );

    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('500000000 raw units')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('$9.5')).toBeInTheDocument();
    expect(screen.getByText('$9.4')).toBeInTheDocument();
  });

  it('shows an em dash for price impact rather than fabricating a number when Jupiter did not return one', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows an em dash for the fee when this quote had no platform fee, rather than "$0"', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ platformFeeAmountRaw: null })} />);
    const feeRow = screen.getByText(/Kamby fee/).closest('div');
    expect(feeRow).toHaveTextContent('—');
  });

  it('does not warn-color a low price-impact trade', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: 22 })} />);
    expect(screen.getByText('0.22%')).toHaveClass('text-ink-900');
  });

  it('warn-colors a medium price-impact trade (1%-2.99%)', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: 150 })} />);
    expect(screen.getByText('1.50%')).toHaveClass('text-warn');
  });

  it('down-colors a high price-impact trade (3%+), distinctly from the medium warning', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: 300 })} />);
    expect(screen.getByText('3.00%')).toHaveClass('text-down');
  });

  it('compact mode renders a condensed single line rather than the full breakdown', () => {
    render(<SolanaQuoteSummary quote={baseQuote()} compact />);

    expect(screen.getByText('98600000 raw units')).toBeInTheDocument();
    expect(screen.getByText('0.22% impact')).toBeInTheDocument();
    expect(screen.getByText('$0.05 fee')).toBeInTheDocument();
    expect(screen.queryByText('You pay')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider')).not.toBeInTheDocument();
  });

  it('compact mode shows the USDC side for a SELL trade\'s output, not raw units', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ side: 'SELL', outputAmountRaw: '9500000' })} compact />);
    expect(screen.getByText('$9.5')).toBeInTheDocument();
  });
});
