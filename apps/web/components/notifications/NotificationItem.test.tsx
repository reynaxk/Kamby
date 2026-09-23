import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationDto } from '@kamby/domain';
import { NotificationItem } from './NotificationItem';

function fakeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    type: 'FOLLOW',
    createdAt: new Date().toISOString(),
    readAt: null,
    actor: { address: '0x1234567890123456789012345678901234567890', displayName: 'trader1', avatarUrl: null },
    token: null,
    amountUsd: null,
    side: null,
    deepLink: null,
    ...overrides,
  };
}

describe('NotificationItem', () => {
  it('shows an unread dot for an unread notification', () => {
    const { container } = render(<NotificationItem notification={fakeNotification({ readAt: null })} onOpen={vi.fn()} />);
    expect(container.querySelector('.bg-accent')).toBeInTheDocument();
  });

  it('shows no unread dot once read', () => {
    render(<NotificationItem notification={fakeNotification({ readAt: new Date().toISOString() })} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button')?.querySelector('.rounded-full.bg-accent')).not.toBeInTheDocument();
  });

  it('renders initials when the actor has no avatar image', () => {
    const { container } = render(
      <NotificationItem notification={fakeNotification({ actor: { address: null, displayName: 'trader1', avatarUrl: null } })} onOpen={vi.fn()} />,
    );
    expect(screen.getByText('TR')).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders the real avatar image when the actor has one', () => {
    // alt="" is deliberate (decorative — the actor's name is already shown as text next to
    // it), which makes this img role="presentation", not role="img" — query by tag, not role.
    const { container } = render(
      <NotificationItem
        notification={fakeNotification({ actor: { address: null, displayName: 'trader1', avatarUrl: 'https://example.com/a.png' } })}
        onOpen={vi.fn()}
      />,
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png');
  });

  it('renders a plain button (not a link) when there is no deep link, and calls onOpen on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<NotificationItem notification={fakeNotification({ deepLink: null })} onOpen={onOpen} />);

    const button = screen.getByRole('button');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders a real link to the deep link when one is present, and calls onOpen on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<NotificationItem notification={fakeNotification({ deepLink: '/market/base/0xaaa' })} onOpen={onOpen} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/market/base/0xaaa');
    await user.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders real copy composed from the notification fields, not a server-sent sentence', () => {
    render(
      <NotificationItem
        notification={fakeNotification({
          type: 'WHALE_TRADE',
          actor: { address: null, displayName: 'whale1', avatarUrl: null },
          token: { address: '0xbbb', symbol: 'FOO', logoUrl: null },
          amountUsd: 50000,
          side: 'BUY',
        })}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText(/whale1 bought .*FOO/i)).toBeInTheDocument();
  });
});
