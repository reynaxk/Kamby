import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, BadRequestException } from '@nestjs/common';
import { prisma, type Prisma } from '@kamby/db';
import {
  containsLink,
  normalizePulseBody,
  PULSE_LIMITS,
  PULSE_REALTIME_CHANNEL,
  type PulseMessage,
  type PulsePage,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { REDIS_CLIENT } from '../redis/redis.module';

const MESSAGE_INCLUDE = {
  user: {
    select: {
      username: true,
      avatarUrl: true,
      wallets: { where: { verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' }, take: 1, select: { address: true } },
    },
  },
} satisfies Prisma.PulseMessageInclude;

type MessageRow = Prisma.PulseMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

function toDto(row: MessageRow): PulseMessage {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: {
      username: row.user.username,
      avatarUrl: row.user.avatarUrl,
      address: row.user.wallets[0]?.address ?? null,
    },
  };
}

/**
 * Pulse, the worldwide chat (2026-10-11). Anyone can read; posting needs a signed-in account
 * with a username. Every rule is enforced here, whatever the app does: 1–280 characters, no
 * links (scams), one message per 3s per user, no repeating yourself within a minute. New
 * messages go out live on PULSE_REALTIME_CHANNEL.
 */
@Injectable()
export class PulseService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('PulseService');
  }

  async list(before: string | undefined, limit: number = PULSE_LIMITS.pageSize): Promise<PulsePage> {
    const take = Math.min(Math.max(limit, 1), PULSE_LIMITS.pageSize);
    const beforeDate = before ? new Date(before) : null;
    const rows = await prisma.pulseMessage.findMany({
      where: { hiddenAt: null, ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      include: MESSAGE_INCLUDE,
    });
    const page = rows.slice(0, take);
    return {
      items: page.map(toDto),
      nextBefore: rows.length > take ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }

  async post(userId: string, rawBody: string): Promise<PulseMessage> {
    const body = normalizePulseBody(rawBody ?? '');
    if (body.length === 0) throw new BadRequestException('Write something first.');
    if (body.length > PULSE_LIMITS.maxLength) throw new BadRequestException(`Keep it under ${PULSE_LIMITS.maxLength} characters.`);
    if (containsLink(body)) throw new BadRequestException("Links aren't allowed in Pulse — mention coins with $SYMBOL instead.");

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to chat in Pulse.');

    // One message every few seconds per user (atomic; a Redis outage doesn't block chat).
    const cooled = await this.redis
      .set(`kamby:pulse:cool:${userId}`, '1', 'EX', PULSE_LIMITS.cooldownSeconds, 'NX')
      .catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('Slow down a little — one message every few seconds.', HttpStatus.TOO_MANY_REQUESTS);

    const last = await prisma.pulseMessage.findFirst({
      where: { userId, createdAt: { gte: new Date(Date.now() - PULSE_LIMITS.duplicateWindowSeconds * 1000) } },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    });
    if (last && last.body.toLowerCase() === body.toLowerCase()) {
      throw new HttpException('You just said that.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const row = await prisma.pulseMessage.create({ data: { userId, body }, include: MESSAGE_INCLUDE });
    const dto = toDto(row);
    await this.redis.publish(PULSE_REALTIME_CHANNEL, JSON.stringify(dto)).catch((error: unknown) => {
      this.logger.warn({ err: error }, 'Pulse realtime publish failed — readers get it on their next load');
    });
    return dto;
  }
}
