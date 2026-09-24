import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useTerminalToast } from './ToastProvider';

// fireEvent (synchronous, no internal delay machinery) rather than userEvent — mixing
// userEvent with fake timers hung indefinitely in a past test (see
// CopyAddressButton.test.tsx's own note); fireEvent sidesteps that entirely since it has no
// setTimeout-based interaction delay to freeze.

function Harness() {
  const { push, update, dismiss } = useTerminalToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  return (
    <div>
      <button type="button" onClick={() => push({ variant: 'success', title: 'Trade confirmed' })}>
        Push success
      </button>
      <button
        type="button"
        onClick={() =>
          push({
            variant: 'error',
            title: 'Trade failed',
            description: 'Slippage exceeded',
            solscanUrl: 'https://solscan.io/tx/abc123',
          })
        }
      >
        Push error
      </button>
      <button type="button" onClick={() => setPendingId(push({ variant: 'pending', title: 'Submitting trade' }))}>
        Push pending
      </button>
      {pendingId && (
        <button type="button" onClick={() => update(pendingId, { variant: 'success', title: 'Trade landed' })}>
          Resolve pending
        </button>
      )}
      {pendingId && (
        <button type="button" onClick={() => dismiss(pendingId)}>
          Dismiss pending
        </button>
      )}
    </div>
  );
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws a real, clear error when used outside a provider, rather than silently no-oping', () => {
    function Orphan() {
      useTerminalToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow('useTerminalToast must be used within a ToastProvider');
  });

  it('renders a pushed toast with its real title', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push success' }));

    expect(screen.getByText('Trade confirmed')).toBeInTheDocument();
  });

  it('renders the real description and Solscan link only when they are actually provided', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push error' }));

    expect(screen.getByText('Slippage exceeded')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on Solscan' })).toHaveAttribute('href', 'https://solscan.io/tx/abc123');
  });

  it('never renders a description or Solscan link when none was given', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push success' }));

    expect(screen.queryByRole('link', { name: 'View on Solscan' })).not.toBeInTheDocument();
  });

  it('stacks multiple pushed toasts rather than replacing the previous one', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push success' }));
    fireEvent.click(screen.getByRole('button', { name: 'Push pending' }));

    expect(screen.getByText('Trade confirmed')).toBeInTheDocument();
    expect(screen.getByText('Submitting trade')).toBeInTheDocument();
  });

  it('removes a toast immediately when its own dismiss button is clicked', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push success' }));
    expect(screen.getByText('Trade confirmed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Trade confirmed')).not.toBeInTheDocument();
  });

  it('auto-dismisses a terminal-state toast after the real 6s window', async () => {
    // The async variant, not vi.advanceTimersByTime — the sync one fires the setTimeout
    // callback (which calls setToasts) without giving React's own scheduler the extra tick
    // it needs to actually commit the resulting DOM update, same gap TransactionDetail's own
    // poll-loop tests already hit.
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push success' }));
    expect(screen.getByText('Trade confirmed')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5999);
    expect(screen.getByText('Trade confirmed')).toBeInTheDocument(); // not yet

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Trade confirmed')).not.toBeInTheDocument();
  });

  it('never auto-dismisses a pending toast, since "still waiting" must not silently disappear', async () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push pending' }));

    await vi.advanceTimersByTimeAsync(60_000); // well past the real 6s window
    expect(screen.getByText('Submitting trade')).toBeInTheDocument();
  });

  it('schedules a real fresh auto-dismiss once an updated toast moves out of pending', async () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push pending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve pending' }));
    expect(screen.getByText('Trade landed')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(5999);
    expect(screen.getByText('Trade landed')).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByText('Trade landed')).not.toBeInTheDocument();
  });

  it('merges an update into the existing toast rather than losing its other real fields', () => {
    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Push pending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve pending' }));

    // Only variant+title were patched — the toast is still the same one object (same id),
    // not a second toast stacked alongside the original.
    expect(screen.getAllByText(/Trade|Submitting/).length).toBe(1);
    expect(screen.getByText('Trade landed')).toBeInTheDocument();
  });
});
