import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WidgetBoundary } from './WidgetBoundary';

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error('provider timed out');
  return <p>chart ready</p>;
}

describe('WidgetBoundary', () => {
  it('keeps a crash inside the widget and retries it from scratch', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <div>
        <p>rest of the page</p>
        <WidgetBoundary name="chart">
          <Flaky />
        </WidgetBoundary>
      </div>,
    );
    expect(screen.getByText('rest of the page')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent("This part didn't load.");

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('chart ready')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    spy.mockRestore();
  });
});
