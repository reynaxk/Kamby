import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RpcStatusBar } from './RpcStatusBar';

const state = vi.hoisted(() => ({
  connection: null as null | { getSlot: ReturnType<typeof vi.fn> },
}));
// A getter, not a plain value — RpcStatusBar reads `solanaConnection` fresh inside its own
// effect at mount time (not at module-import time), so a getter lets each test flip
// state.connection beforehand and have the component see the right value on render.
vi.mock('@/lib/solana-config', () => ({
  get solanaConnection() {
    return state.connection;
  },
}));

describe('RpcStatusBar', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
    state.connection = null;
  });

  it('shows "RPC unreachable" immediately, never calling getSlot, when no RPC is configured at all', async () => {
    state.connection = null;
    render(<RpcStatusBar />);

    expect(await screen.findByText('RPC unreachable')).toBeInTheDocument();
  });

  it('shows a real "Connecting…" state before the first ping resolves', () => {
    state.connection = { getSlot: vi.fn(() => new Promise(() => {})) };
    render(<RpcStatusBar />);

    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('shows a real measured round-trip time (some number of ms) once the ping succeeds', async () => {
    state.connection = { getSlot: vi.fn().mockResolvedValue(123) };
    render(<RpcStatusBar />);

    expect(await screen.findByText(/^\d+ms$/)).toBeInTheDocument();
  });

  it('shows "RPC unreachable" when a configured connection\'s ping actually fails', async () => {
    state.connection = { getSlot: vi.fn().mockRejectedValue(new Error('timeout')) };
    render(<RpcStatusBar />);

    expect(await screen.findByText('RPC unreachable')).toBeInTheDocument();
  });

  it('colors a real fast round-trip (<=400ms) as healthy, not a warning', async () => {
    // Fake timers (with performance.now included) so the getSlot delay below is exactly
    // controlled — spying directly on performance.now() got consumed by React's own
    // internal scheduler calls before the component's two calls ever saw the mocked values.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    state.connection = {
      getSlot: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(1), 200))),
    };
    render(<RpcStatusBar />);

    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(0);

    const ms = screen.getByText('200ms');
    expect(ms).toHaveClass('text-up');
  });

  it('colors a real slow round-trip (>400ms) as a warning, not silently healthy', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    state.connection = {
      getSlot: vi.fn(() => new Promise((resolve) => setTimeout(() => resolve(1), 500))),
    };
    render(<RpcStatusBar />);

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(0);

    const ms = screen.getByText('500ms');
    expect(ms).toHaveClass('text-warn');
  });

  it('pings again every real 15s', async () => {
    vi.useFakeTimers();
    const getSlot = vi.fn().mockResolvedValue(1);
    state.connection = { getSlot };
    render(<RpcStatusBar />);
    await vi.advanceTimersByTimeAsync(0);
    expect(getSlot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(getSlot).toHaveBeenCalledTimes(2);
  });
});
