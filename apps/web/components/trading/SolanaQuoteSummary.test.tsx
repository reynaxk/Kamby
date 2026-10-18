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
  it('rounds the coin leg to 2 decimals once its decimals are known', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ outputAmountRaw: '135580012345' })} tokenSymbol="Bonk" tokenDecimals={5} />);
    expect(screen.getByText('1.36M Bonk')).toBeInTheDocument();
  });

  it('a BUY: pay in dollars (swap + fee), get the coin, and the fee in dollars', () => {
    render(<SolanaQuoteSummary quote={baseQuote()} tokenSymbol="SOL" tokenDecimals={9} />);
    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('$10.05')).toBeInTheDocument();
    expect(screen.getByText('You get')).toBeInTheDocument();
    expect(screen.getByText('0.10 SOL')).toBeInTheDocument();
    expect(screen.getByText('$0.05')).toBeInTheDocument();
    expect(screen.queryByText(/minimum received|jupiter|impact/i)).not.toBeInTheDocument();
  });

  it('a SELL: pay in the coin, get dollars', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ side: 'SELL', inputAmountRaw: '500000000', outputAmountRaw: '9500000' })} tokenSymbol="SOL" tokenDecimals={9} />);
    expect(screen.getByText('0.50 SOL')).toBeInTheDocument();
    expect(screen.getByText('$9.50')).toBeInTheDocument();
  });

  it('folds the new-coin setup into the one Fee line', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ setupFeeAmountRaw: '300000' })} tokenSymbol="SOL" tokenDecimals={9} />);
    expect(screen.getByText('$0.35')).toBeInTheDocument();
  });

  it('shows an em dash for the fee when this quote had none, rather than "$0"', () => {
    render(<SolanaQuoteSummary quote={baseQuote({ platformFeeBps: 0, platformFeeAmountRaw: null })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('warns only on a high (3%+) price impact', () => {
    const { rerender } = render(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: 450 })} />);
    expect(screen.getByText(/high price impact/i)).toBeInTheDocument();
    rerender(<SolanaQuoteSummary quote={baseQuote({ priceImpactBps: 150 })} />);
    expect(screen.queryByText(/price impact/i)).not.toBeInTheDocument();
  });
});
