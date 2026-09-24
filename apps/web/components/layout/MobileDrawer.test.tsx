import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileDrawer } from './MobileDrawer';

describe('MobileDrawer', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('renders nothing at all when closed', () => {
    render(
      <MobileDrawer open={false} onClose={vi.fn()} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders a real modal dialog with the given title and children when open', () => {
    render(
      <MobileDrawer open onClose={vi.fn()} title="Trade">
        <div>real content</div>
      </MobileDrawer>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-label', 'Trade');
    expect(screen.getByText('real content')).toBeInTheDocument();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MobileDrawer open onClose={onClose} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never listens for Escape while closed — no leaked handler firing onClose before it ever opens', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MobileDrawer open={false} onClose={onClose} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );

    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <MobileDrawer open onClose={onClose} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );

    const backdrop = container.querySelector('[aria-hidden]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <MobileDrawer open onClose={onClose} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open', () => {
    render(
      <MobileDrawer open onClose={vi.fn()} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the real previous overflow value on unmount, not just clearing it to empty', () => {
    document.body.style.overflow = 'scroll'; // a real pre-existing value, not the default
    const { unmount } = render(
      <MobileDrawer open onClose={vi.fn()} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it('never locks body scroll while closed', () => {
    document.body.style.overflow = '';
    render(
      <MobileDrawer open={false} onClose={vi.fn()} title="Trade">
        <div>content</div>
      </MobileDrawer>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});
