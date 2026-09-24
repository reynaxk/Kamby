import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TradeModal } from './TradeModal';

describe('TradeModal', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing at all when closed', () => {
    render(
      <TradeModal open={false} onClose={vi.fn()}>
        <div>content</div>
      </TradeModal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a real modal dialog with its children when open', () => {
    render(
      <TradeModal open onClose={vi.fn()}>
        <div>real trade panel content</div>
      </TradeModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('real trade panel content')).toBeInTheDocument();
  });

  it('renders via a real portal to document.body, not inline in its own render tree', () => {
    const { container } = render(
      <TradeModal open onClose={vi.fn()}>
        <div>content</div>
      </TradeModal>,
    );
    expect(container).toBeEmptyDOMElement(); // nothing rendered in the local subtree
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <TradeModal open onClose={onClose}>
        <div>content</div>
      </TradeModal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never listens for Escape while closed — no leaked handler firing onClose before it ever opens', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <TradeModal open={false} onClose={onClose}>
        <div>content</div>
      </TradeModal>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <TradeModal open onClose={onClose}>
        <div>content</div>
      </TradeModal>,
    );

    const backdrop = document.body.querySelector('[aria-hidden]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never closes when clicking inside the dialog content itself', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <TradeModal open onClose={onClose}>
        <div>real trade panel content</div>
      </TradeModal>,
    );

    await user.click(screen.getByText('real trade panel content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks body scroll while open', () => {
    render(
      <TradeModal open onClose={vi.fn()}>
        <div>content</div>
      </TradeModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the real previous overflow value on unmount, not just clearing it to empty', () => {
    document.body.style.overflow = 'scroll'; // a real pre-existing value, not the default
    const { unmount } = render(
      <TradeModal open onClose={vi.fn()}>
        <div>content</div>
      </TradeModal>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('never locks body scroll while closed', () => {
    document.body.style.overflow = '';
    render(
      <TradeModal open={false} onClose={vi.fn()}>
        <div>content</div>
      </TradeModal>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});
