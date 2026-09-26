import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GlobalError from './global-error';

describe('GlobalError', () => {
  // Rendering this component's own <html>/<body> inside RTL's container <div> trips React's
  // validateDOMNesting warning — real Next.js swaps out the whole document for this file
  // instead of mounting into a container, so the warning is a testing artifact, not a defect.
  // Spying on console.error (rather than ignoring it) also lets the third test still assert on
  // the real diagnostic log call.
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('shows a real, branded error message, never a raw stack trace', () => {
    render(<GlobalError error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('calls reset() when "Try again" is clicked', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    render(<GlobalError error={new Error('boom')} reset={reset} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(reset).toHaveBeenCalled();
  });

  it('logs the real error digest/message to the console for diagnosis, without surfacing either in the UI', () => {
    const error = Object.assign(new Error('real failure message'), { digest: 'abc123' });

    render(<GlobalError error={error} reset={vi.fn()} />);

    expect(consoleError).toHaveBeenCalledWith('Unhandled root-layout error', { digest: 'abc123', message: 'real failure message' });
  });
});
