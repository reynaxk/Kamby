import { randomUUID } from 'node:crypto';
import { prisma } from '@kamby/db';
import { LIVE_LIMITS, LIVE_REALTIME_CHANNEL, type LiveChatLine, type LiveEvent } from '@kamby/domain';
import type { Redis } from 'ioredis';

/** Which live room someone is in right now (host or viewer) — refreshed by every heartbeat. */
const whereKey = (userId: string) => `kamby:live:where:${userId}`;
const chatKey = (roomId: string) => `kamby:live:${roomId}:chat`;

export async function markInRoom(redis: Redis, userId: string, roomId: string): Promise<void> {
  await redis.set(whereKey(userId), roomId, 'PX', LIVE_LIMITS.viewerStaleMs).catch(() => undefined);
}

/** Adds a line to a room's chat (the last LIVE_LIMITS.chatKeep are kept) and sends it to everyone watching. */
export async function pushLiveLine(redis: Redis, roomId: string, line: LiveChatLine): Promise<void> {
  await redis.lpush(chatKey(roomId), JSON.stringify(line));
  await redis.ltrim(chatKey(roomId), 0, LIVE_LIMITS.chatKeep - 1);
  await redis.expire(chatKey(roomId), 12 * 3600);
  const event: LiveEvent = { type: 'chat', roomId, line };
  await redis.publish(LIVE_REALTIME_CHANNEL, JSON.stringify(event));
}

/**
 * Trade alerts (2026-10-30): a Kamby trade by the host or anyone watching shows up in that room's
 * chat — "bought $120 of $WIF". Called with every confirmed trade (announceTradeInChat); costs one
 * Redis read when the trader isn't in a live, and never throws.
 */
export async function announceTradeInLive(
  redis: Redis,
  trade: { userId: string; chainIdentifier: string; tokenAddress: string; side: 'BUY' | 'SELL'; usd: number },
): Promise<void> {
  try {
    const roomId = await redis.get(whereKey(trade.userId));
    if (!roomId || !(trade.usd > 0)) return;
    const [user, symbol] = await Promise.all([
      prisma.user.findUnique({ where: { id: trade.userId }, select: { username: true, avatarUrl: true } }),
      coinSymbol(trade.chainIdentifier, trade.tokenAddress),
    ]);
    if (!user?.username) return;
    const room = await redis.get(`kamby:live:${roomId}`);
    if (!room) return;
    const hostId = (JSON.parse(room) as { host: { userId: string } }).host.userId;
    await pushLiveLine(redis, roomId, {
      id: randomUUID(),
      userId: trade.userId,
      username: user.username,
      avatarUrl: user.avatarUrl,
      body: `${trade.side === 'BUY' ? 'bought' : 'sold'} $${formatUsd(trade.usd)} of ${symbol ? `$${symbol}` : 'a coin'}`,
      at: new Date().toISOString(),
      host: trade.userId === hostId,
      kind: 'trade',
      amountUsd: trade.usd,
    });
  } catch {
    // best effort
  }
}

async function coinSymbol(chainIdentifier: string, tokenAddress: string): Promise<string | null> {
  if (chainIdentifier === 'solana') {
    const [m, p] = await Promise.all([
      prisma.solanaTokenMarket.findUnique({ where: { mintAddress: tokenAddress }, select: { symbol: true } }),
      prisma.pumpFunToken.findUnique({ where: { mintAddress: tokenAddress }, select: { symbol: true } }),
    ]);
    return m?.symbol ?? p?.symbol ?? null;
  }
  const t = await prisma.token.findFirst({ where: { contractAddress: { equals: tokenAddress, mode: 'insensitive' }, chain: { identifier: chainIdentifier } }, select: { symbol: true } });
  return t?.symbol ?? null;
}

function formatUsd(usd: number): string {
  return usd >= 1000 ? usd.toLocaleString('en-US', { maximumFractionDigits: 0 }) : usd.toFixed(2);
}
