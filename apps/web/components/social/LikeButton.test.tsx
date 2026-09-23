import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LikeButton } from './LikeButton';

const { likeActivity, unlikeActivity } = vi.hoisted(() => ({
  likeActivity: vi.fn(),
  unlikeActivity: vi.fn(),
}));
vi.mock('@/lib/social-client', () => ({ likeActivity, unlikeActivity }));

const ACTIVITY_ID = 'activity-1';

describe('LikeButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the unliked state and initial count', () => {
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={3} initialLikedByMe={false} />);
    const button = screen.getByRole('button', { name: 'Like' });
    expect(button).toHaveTextContent('3');
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the already-liked state and count', () => {
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={5} initialLikedByMe />);
    const button = screen.getByRole('button', { name: 'Unlike' });
    expect(button).toHaveTextContent('5');
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('treats a null initialLikedByMe (server could not know) as not liked', () => {
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={0} initialLikedByMe={null} />);
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
  });

  it('clicking Like optimistically flips to liked and increments the count, then calls likeActivity', async () => {
    likeActivity.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={3} initialLikedByMe={false} />);

    await user.click(screen.getByRole('button', { name: 'Like' }));

    expect(screen.getByRole('button', { name: 'Unlike' })).toHaveTextContent('4');
    await waitFor(() => expect(likeActivity).toHaveBeenCalledWith(ACTIVITY_ID));
  });

  it('clicking Unlike optimistically flips back and decrements the count, then calls unlikeActivity', async () => {
    unlikeActivity.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={3} initialLikedByMe />);

    await user.click(screen.getByRole('button', { name: 'Unlike' }));

    expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('2');
    await waitFor(() => expect(unlikeActivity).toHaveBeenCalledWith(ACTIVITY_ID));
  });

  it('never lets the count go negative when unliking from zero', async () => {
    unlikeActivity.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={0} initialLikedByMe />);

    await user.click(screen.getByRole('button', { name: 'Unlike' }));
    expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('0');
  });

  it('rolls back both the liked state and the count when the like request fails', async () => {
    // Not asserting the optimistic mid-flight state here (unlike the count-clamping tests
    // above) — with a mock that rejects effectively instantly, userEvent.click can already
    // observe the rollback by the time it resolves, racing an intermediate assertion. Same
    // reasoning FollowButton.test.tsx's own rollback test already follows: only the final,
    // settled state is reliably observable.
    likeActivity.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={3} initialLikedByMe={false} />);

    await user.click(screen.getByRole('button', { name: 'Like' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Like' })).toHaveTextContent('3'); // rolled back, not stuck at 4
  });

  it('rolls back both the liked state and the count when the unlike request fails', async () => {
    unlikeActivity.mockRejectedValue(new Error('network error'));
    const user = userEvent.setup();
    render(<LikeButton activityId={ACTIVITY_ID} initialLikes={3} initialLikedByMe />);

    await user.click(screen.getByRole('button', { name: 'Unlike' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Unlike' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Unlike' })).toHaveTextContent('3'); // rolled back, not stuck at 2
  });
});
