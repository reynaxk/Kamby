import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TradeQuoteDto } from '@kamby/domain';
import { QuoteSummary } from './QuoteSummary';

function baseQuote(overrides: Partial<TradeQuoteDto> = {}): TradeQuoteDto {
  return {
    id: 'quote-1',
    chainId: 8453,
    side: 'BUY',
    token: { address: '0xaaa', symbol: 'FOO', decimals: 18 },
    quoteToken: { address: '0xbbb', symbol: 'WETH', decimals: 18 },
    inputAmount: '1000000000000000000',
    expectedOutputAmount: '100000000000000000000',
    minOutputAmount: '99500000000000000000',
    inputAmountFormatted: '1.0',
    expectedOutputAmountFormatted: '100.0',
    minOutputAmountFormatted: '99.5',
    priceUsd: 2.5,
    priceImpactBps: 42,
    priceImpactLevel: 'normal',
    slippageBps: 50,
    platformFeeBps: 50,
    platformFeeAmount: '500000000000000000',
    platformFeeAmountFormatted: '0.5',
    provider: 'li.fi',
    expiresAt: '2026-01-01T00:00:30.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    unsignedTx: { to: '0xdead', data: '0xbeef', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    feeUnsignedTx: null,
    safetyNote: 'No known issues detected by available checks.',
    requiresApproval: false,
    approvalSpender: null,
    sponsorshipAvailable: false,
    ...overrides,
  };
}

describe('QuoteSummary', () => {
  it('shows only what matters — you pay, you get, the fee — rounded to 2 decimals', () => {
    render(<QuoteSummary quote={baseQuote({ inputAmountFormatted: '1.0', expectedOutputAmountFormatted: '650.163381321072902143' })} />);

    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('1.00 WETH')).toBeInTheDocument();
    expect(screen.getByText('You get')).toBeInTheDocument();
    expect(screen.getByText('650.16 FOO')).toBeInTheDocument();
    expect(screen.getByText('Fee')).toBeInTheDocument();
    expect(screen.getByText('0.50 FOO')).toBeInTheDocument(); // aggregator cut, in the output token
    expect(screen.queryByText(/minimum received|provider|slippage/i)).not.toBeInTheDocument();
  });

  it('shows dollar amounts as $ — a USDC buy and its fee', () => {
    render(
      <QuoteSummary
        quote={baseQuote({
          quoteToken: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
          inputAmountFormatted: '3',
          platformFeeAmountFormatted: '0.12',
        })}
      />,
    );
    expect(screen.getByText('$3.00')).toBeInTheDocument();
    expect(screen.getByText('$0.12')).toBeInTheDocument();
  });

  it('labels a SELL fee in the token it lands in, not the token being sold', () => {
    render(<QuoteSummary quote={baseQuote({ side: 'SELL' })} />);
    expect(screen.getByText('0.50 WETH')).toBeInTheDocument();
  });

  it('keeps tiny amounts readable instead of rounding them to 0.00', () => {
    render(<QuoteSummary quote={baseQuote({ expectedOutputAmountFormatted: '0.000123456' })} />);
    expect(screen.getByText('0.00012 FOO')).toBeInTheDocument();
  });

  it('warns on high and extreme price impact, and stays quiet otherwise', () => {
    const { rerender } = render(<QuoteSummary quote={baseQuote({ priceImpactLevel: 'high', priceImpactBps: 450 })} />);
    expect(screen.getByText(/high price impact/i)).toBeInTheDocument();
    rerender(<QuoteSummary quote={baseQuote({ priceImpactLevel: 'extreme', priceImpactBps: 1500 })} />);
    expect(screen.getByText(/extreme price impact/i)).toBeInTheDocument();
    rerender(<QuoteSummary quote={baseQuote()} />);
    expect(screen.queryByText(/price impact/i)).not.toBeInTheDocument();
  });
});
