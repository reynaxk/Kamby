import type { CallState } from '@kamby/domain';
import { cameraFits, downloadBytes } from './calls.service';

const call = (cameras: number): CallState => ({
  id: 'c',
  conversationId: 'conv',
  startedBy: 'a',
  startedAt: new Date().toISOString(),
  video: true,
  ringing: [],
  participants: Array.from({ length: cameras }, (_, i) => ({
    userId: `u${i}`,
    sessionId: `s${i}`,
    joinedAt: new Date().toISOString(),
    muted: false,
    tracks: [
      { trackName: `u${i}:audio:x`, kind: 'audio' as const },
      { trackName: `u${i}:video:x`, kind: 'video' as const },
    ],
  })),
});

describe('CallsService helpers', () => {
  it('lets at most 8 cameras on at once', () => {
    expect(cameraFits(call(7))).toBe(true);
    expect(cameraFits(call(8))).toBe(false);
  });

  it("counts what one person downloads: everyone else's tracks, not their own", () => {
    // 2 others × (40 + 1200 kbps) for 10 s
    expect(downloadBytes(call(3), 'u0', 10)).toBe(Math.round((2 * 1240 * 1000 * 10) / 8));
  });
});
