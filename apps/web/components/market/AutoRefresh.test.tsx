import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoRefresh } from './AutoRefresh';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

describe('AutoRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never refreshes before the configured interval has actually elapsed', () => {
    render(<AutoRefresh intervalSeconds={30} />);
    vi.advanceTimersByTime(29_999);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes exactly once the real configured interval elapses, and repeats on each cycle after', () => {
    render(<AutoRefresh intervalSeconds={30} />);
    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops refreshing after unmount — no leaked interval still firing router.refresh()', () => {
    const { unmount } = render(<AutoRefresh intervalSeconds={30} />);
    unmount();

    vi.advanceTimersByTime(60_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('renders nothing to the DOM — this is a pure background-effect component', () => {
    const { container } = render(<AutoRefresh intervalSeconds={30} />);
    expect(container).toBeEmptyDOMElement();
  });
});
