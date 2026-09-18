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
  it('shows exactly what the signed transaction will do — pay/receive/fee/impact/slippage', () => {
    render(<QuoteSummary quote={baseQuote()} />);

    expect(screen.getByText('You pay')).toBeInTheDocument();
    expect(screen.getByText('1.0 WETH')).toBeInTheDocument();
    expect(screen.getByText('You receive')).toBeInTheDocument();
    expect(screen.getByText('100.0 FOO')).toBeInTheDocument();
    expect(screen.getByText('0.5 FOO')).toBeInTheDocument(); // Kamby fee, in the output token
    expect(screen.getByText('0.42%')).toBeInTheDocument(); // priceImpactBps -> percent
    expect(screen.getByText('0.5%')).toBeInTheDocument(); // slippageBps -> percent
  });

  it('never claims a token is "safe" — only the bounded, honest disclosure', () => {
    render(<QuoteSummary quote={baseQuote()} />);
    expect(screen.getByText('No known issues detected by available checks.')).toBeInTheDocument();
    expect(screen.queryByText(/\bsafe\b/i)).not.toBeInTheDocument();
  });

  it('surfaces a high price-impact warning', () => {
    render(<QuoteSummary quote={baseQuote({ priceImpactBps: 800, priceImpactLevel: 'high' })} />);
    expect(screen.getByText(/high price impact/i)).toBeInTheDocument();
  });

  it('surfaces an extreme price-impact warning distinctly from "high"', () => {
    render(<QuoteSummary quote={baseQuote({ priceImpactBps: 1600, priceImpactLevel: 'extreme' })} />);
    expect(screen.getByText(/extreme price impact/i)).toBeInTheDocument();
  });

  it('shows no impact warning for a normal-impact quote', () => {
    render(<QuoteSummary quote={baseQuote()} />);
    expect(screen.queryByText(/price impact —/i)).not.toBeInTheDocument();
  });

  it('surfaces when a token approval is required before this trade can be signed', () => {
    render(<QuoteSummary quote={baseQuote({ requiresApproval: true, approvalSpender: '0xspender' })} />);
    expect(screen.getByText('Required before this trade')).toBeInTheDocument();
  });

  it('labels a SELL trade\'s fee with the quote token it actually lands in, not the token being sold', () => {
    render(<QuoteSummary quote={baseQuote({ side: 'SELL' })} />);
    // Same platformFeeAmountFormatted ('0.5') as the BUY fixture, but the currency label
    // must follow the output side (quoteToken/WETH for a SELL), never quote.token (FOO).
    expect(screen.getByText('0.5 WETH')).toBeInTheDocument();
  });

  it('shows the two-signature disclosure and labels the fee in USDC when the quote carries a guaranteed-USDC feeUnsignedTx', () => {
    const feeUnsignedTx = { to: '0xusdc', data: '0xtransfer', value: '0', gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null };
    render(
      <QuoteSummary
        quote={baseQuote({
          quoteToken: { address: '0xusdc', symbol: 'USDC', decimals: 6 },
          feeUnsignedTx,
        })}
      />,
    );

    expect(screen.getByText('0.5 USDC')).toBeInTheDocument();
    expect(screen.getByText(/two signatures/i)).toBeInTheDocument();
  });

  it('shows no two-signature disclosure when the fee rides the aggregator\'s own embedded cut', () => {
    render(<QuoteSummary quote={baseQuote()} />); // feeUnsignedTx: null
    expect(screen.queryByText(/two signatures/i)).not.toBeInTheDocument();
  });
});
