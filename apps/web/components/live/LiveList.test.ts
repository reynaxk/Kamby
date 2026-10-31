import type { LiveRoom } from '@kamby/domain';
import { describe, expect, it } from 'vitest';
import { compareRooms, inCategory } from './LiveList';

const room = (id: string, viewers: number, volumeUsd: number, extra: Partial<LiveRoom> = {}): LiveRoom =>
  ({ id, viewers, volumeUsd, startedAt: '2026-10-31T10:00:00Z', coin: null, category: 'chart', ...extra }) as LiveRoom;

describe('live list', () => {
  it('sorts by viewers or by traded volume', () => {
    const rooms = [room('a', 10, 50), room('b', 3, 900), room('c', 10, 400)];
    expect([...rooms].sort(compareRooms('watched')).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect([...rooms].sort(compareRooms('traded')).map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('filters by topic and by the coin chain', () => {
    const voice = room('v', 1, 0, { category: 'voice' });
    const sol = room('s', 1, 0, { coin: { chainIdentifier: 'solana', tokenAddress: 'x', symbol: 'X', logoUrl: null } });
    expect(inCategory(voice, 'voice')).toBe(true);
    expect(inCategory(voice, 'chart')).toBe(false);
    expect(inCategory(sol, 'solana')).toBe(true);
    expect(inCategory(sol, 'all')).toBe(true);
  });
});
