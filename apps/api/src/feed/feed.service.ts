import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prisma, type Prisma } from '@kamby/db';
import {
  containsLink,
  FEED_LIMITS,
  normalizePulseBody,
  type DmPnl,
  type DmTrade,
  type FeedPhoto,
  type FeedVideo,
  type FeedAuthor,
  type FeedPage,
  type FeedPost,
  type FeedReply,
  type FeedTab,
} from '@kamby/domain';
import type { Redis } from 'ioredis';
import { DmService } from '../dm/dm.service';
import { NotificationService } from '../notifications/notification.service';
import { ImageModerationService } from '../media/image-moderation.service';
import { R2StorageService, type UploadableFile } from '../media/r2-storage.service';
import { REDIS_CLIENT } from '../redis/redis.module';

const AUTHOR = {
  select: {
    id: true,
    username: true,
    avatarUrl: true,
    wallets: { where: { verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' }, take: 1, select: { address: true } },
  },
} satisfies Prisma.UserDefaultArgs;

type AuthorRow = Prisma.UserGetPayload<typeof AUTHOR>;

function author(u: AuthorRow): FeedAuthor {
  return { userId: u.id, username: u.username, avatarUrl: u.avatarUrl, address: u.wallets[0]?.address ?? null };
}

/** Pulse's text rules, with the feed's own length. */
export function cleanBody(raw: string, max: number, allowEmpty = false): string {
  const body = normalizePulseBody(raw ?? '');
  if (!allowEmpty && body.length === 0) throw new BadRequestException('Write something first.');
  if (body.length > max) throw new BadRequestException(`Keep it under ${max} characters.`);
  if (containsLink(body)) throw new BadRequestException("Links aren't allowed — mention coins with $SYMBOL instead.");
  return body;
}

/**
 * The Feed (2026-10-30, owner's concepts). Anyone can read; posting needs an account with a
 * username. Every rule is enforced here: up to 500 characters, no links, one post per 30s,
 * no repeating yourself, a Trade/PnL card only from your own real position (built here, never
 * typed in). Three reports from different people hide a post; you can delete your own.
 */
@Injectable()
export class FeedService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly dm: DmService,
    private readonly moderation: ImageModerationService,
    private readonly r2: R2StorageService,
    private readonly notifications: NotificationService,
  ) {}

  /** Photos are on only when moderation is configured (Sightengine keys on the API). */
  capabilities(): { photos: boolean; videos: boolean } {
    const on = this.moderation.isConfigured();
    return { photos: on, videos: on };
  }


  /**
   * A short video for a post (2026-10-30): up to 15 s / 20 MB, every 3rd second checked by
   * Sightengine BEFORE it's stored (fails closed). No daily caps (owner, 10-30).
   */
  async uploadVideo(me: string, file: UploadableFile | undefined, apiOrigin: string): Promise<{ videoId: string; url: string }> {
    if (!file) throw new BadRequestException('Pick a video first.');
    if (!this.moderation.isConfigured()) throw new ServiceUnavailableException('Videos are not switched on yet.');
    const user = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to post.');
    const type = file.mimetype.split(';')[0]!.trim();
    if (!/^video\/(mp4|webm|quicktime)$/.test(type)) throw new BadRequestException('Only MP4, WebM or MOV videos.');
    if (file.size > FEED_LIMITS.videoMaxBytes) throw new BadRequestException('That video is over 20 MB.');
    const verdict = await this.moderation.checkVideo(file.buffer, type, FEED_LIMITS.videoMaxSeconds);
    if (!verdict.ok) {
      throw new BadRequestException(
        verdict.reason === 'long' ? `Keep it under ${FEED_LIMITS.videoMaxSeconds} seconds.` : verdict.reason === 'error' ? "We couldn't check that video — try again in a moment." : "That video can't be posted on Kamby.",
      );
    }
    const url = await this.r2.uploadFeedVideo(me, file, apiOrigin);
    const videoId = randomUUID();
    await this.redis.set(`kamby:feed:video:${videoId}`, JSON.stringify({ userId: me, url }), 'EX', 3600);
    return { videoId, url };
  }

  /**
   * A photo for a post (2026-10-30): checked by Sightengine BEFORE it's stored — refused if it
   * shows nudity, gore or weapons, or if the check can't run. Returns a one-hour ticket to attach to the post.
   */
  async uploadPhoto(me: string, file: UploadableFile | undefined, apiOrigin: string): Promise<{ photoId: string; url: string }> {
    if (!file) throw new BadRequestException('Pick a photo first.');
    if (!this.moderation.isConfigured()) throw new ServiceUnavailableException('Photos are not switched on yet.');
    const user = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to post.');
    if (!/^image\/(png|jpeg|webp)$/.test(file.mimetype)) throw new BadRequestException('Only PNG, JPEG or WebP photos.');
    if (file.size > FEED_LIMITS.photoMaxBytes) throw new BadRequestException('That photo is over 5 MB.');

    const verdict = await this.moderation.check(file.buffer, file.mimetype);
    if (!verdict.ok) {
      throw new BadRequestException(verdict.reason === 'error' ? "We couldn't check that photo — try again in a moment." : "That photo can't be posted on Kamby.");
    }
    const url = await this.r2.uploadFeedPhoto(me, file, apiOrigin);
    const photoId = randomUUID();
    await this.redis.set(`kamby:feed:photo:${photoId}`, JSON.stringify({ userId: me, url }), 'EX', 3600);
    return { photoId, url };
  }

  async list(me: string | null, tab: FeedTab, before?: string, authorId?: string): Promise<FeedPage> {
    const take = FEED_LIMITS.pageSize;
    const beforeDate = before ? new Date(before) : null;
    let userFilter: Prisma.FeedPostWhereInput = {};
    if (authorId) userFilter = { userId: authorId };
    else if (tab === 'following') {
      if (!me) return { items: [], nextBefore: null };
      const follows = await prisma.follow.findMany({ where: { userId: me }, select: { walletAddress: true } });
      if (follows.length === 0) return { items: [], nextBefore: null };
      userFilter = { user: { wallets: { some: { address: { in: follows.map((f) => f.walletAddress) } } } } };
    }
    const rows = await prisma.feedPost.findMany({
      where: { hiddenAt: null, ...userFilter, ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { createdAt: { lt: beforeDate } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      include: { user: AUTHOR, ...(me ? { likes: { where: { userId: me }, select: { userId: true } } } : {}) },
    });
    const page = rows.slice(0, take);
    return {
      items: page.map((r) => this.toDto(r, me)),
      nextBefore: rows.length > take ? page[page.length - 1]!.createdAt.toISOString() : null,
    };
  }

  /** A trader's posts by their profile address (their verified wallet). */
  async byAddress(me: string | null, address: string, before?: string): Promise<FeedPage> {
    const wallet = await prisma.wallet.findFirst({ where: { address: { equals: address, mode: 'insensitive' }, verifiedAt: { not: null } }, select: { userId: true } });
    if (!wallet?.userId) return { items: [], nextBefore: null };
    return this.list(me, 'foryou', before, wallet.userId);
  }

  async post(me: string, input: { body: string; attach?: { kind: 'trade' | 'pnl' | 'photo' | 'video'; chain?: string; tokenAddress?: string; photoId?: string; videoId?: string } }): Promise<FeedPost> {
    const body = cleanBody(input.body, FEED_LIMITS.maxLength, Boolean(input.attach));
    const user = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to post.');

    const cooled = await this.redis.set(`kamby:feed:cool:${me}`, '1', 'EX', FEED_LIMITS.cooldownSeconds, 'NX').catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('One post every 30 seconds — take a breath.', HttpStatus.TOO_MANY_REQUESTS);

    if (body) {
      const last = await prisma.feedPost.findFirst({ where: { userId: me, createdAt: { gte: new Date(Date.now() - 3_600_000) } }, orderBy: { createdAt: 'desc' }, select: { body: true } });
      if (last && last.body.toLowerCase() === body.toLowerCase()) throw new HttpException('You just posted that.', HttpStatus.TOO_MANY_REQUESTS);
    }

    let kind: FeedPost['kind'] = 'text';
    let data: DmTrade | DmPnl | FeedPhoto | FeedVideo | null = null;
    if (input.attach?.kind === 'video') {
      const ticket = input.attach.videoId ? await this.redis.getdel(`kamby:feed:video:${input.attach.videoId}`) : null;
      const parsed = ticket ? (JSON.parse(ticket) as { userId: string; url: string }) : null;
      if (!parsed || parsed.userId !== me) throw new BadRequestException('Upload the video again.');
      kind = 'video';
      data = { url: parsed.url };
    } else if (input.attach?.kind === 'photo') {
      // Only a photo this person uploaded (and moderation passed) in the last hour.
      const ticket = input.attach.photoId ? await this.redis.getdel(`kamby:feed:photo:${input.attach.photoId}`) : null;
      const parsed = ticket ? (JSON.parse(ticket) as { userId: string; url: string }) : null;
      if (!parsed || parsed.userId !== me) throw new BadRequestException('Upload the photo again.');
      kind = 'photo';
      data = { url: parsed.url };
    } else if (input.attach) {
      if (!input.attach.chain || !input.attach.tokenAddress) throw new BadRequestException('Pick a coin for the card.');
      kind = input.attach.kind;
      data = kind === 'trade' ? await this.dm.tradeCard(me, input.attach.chain, input.attach.tokenAddress) : await this.dm.pnlCard(me, input.attach.chain, input.attach.tokenAddress);
    }
    const row = await prisma.feedPost.create({
      data: { userId: me, body, kind, data: (data ?? undefined) as Prisma.InputJsonValue | undefined },
      include: { user: AUTHOR },
    });
    return this.toDto(row, me);
  }

  /** Like or unlike; returns the new count. */
  async like(me: string, postId: string, on: boolean): Promise<{ likeCount: number; likedByMe: boolean }> {
    const post = await prisma.feedPost.findFirst({ where: { id: postId, hiddenAt: null }, select: { id: true, userId: true } });
    if (!post) throw new NotFoundException('That post is gone.');
    const exists = await prisma.feedLike.findUnique({ where: { postId_userId: { postId, userId: me } } });
    if (on && !exists) {
      await prisma.$transaction([prisma.feedLike.create({ data: { postId, userId: me } }), prisma.feedPost.update({ where: { id: postId }, data: { likeCount: { increment: 1 } } })]);
      void this.notifications.notifyFeed({ ownerId: post.userId, actorId: me, kind: 'like', postId, dedupe: `feedlike:${postId}:${me}` }).catch(() => undefined);
    } else if (!on && exists) {
      await prisma.$transaction([prisma.feedLike.delete({ where: { postId_userId: { postId, userId: me } } }), prisma.feedPost.update({ where: { id: postId }, data: { likeCount: { decrement: 1 } } })]);
    }
    const after = await prisma.feedPost.findUniqueOrThrow({ where: { id: postId }, select: { likeCount: true } });
    return { likeCount: Math.max(0, after.likeCount), likedByMe: on };
  }

  async replies(me: string | null, postId: string): Promise<FeedReply[]> {
    const rows = await prisma.feedReply.findMany({
      where: { postId, hiddenAt: null, post: { hiddenAt: null } },
      orderBy: { createdAt: 'asc' },
      take: FEED_LIMITS.repliesPageSize,
      include: { user: AUTHOR },
    });
    return rows.map((r) => ({ id: r.id, author: author(r.user), body: r.body, mine: r.userId === me, createdAt: r.createdAt.toISOString() }));
  }

  async reply(me: string, postId: string, raw: string): Promise<FeedReply> {
    const body = cleanBody(raw, FEED_LIMITS.replyMaxLength);
    const user = await prisma.user.findUnique({ where: { id: me }, select: { username: true } });
    if (!user?.username) throw new ForbiddenException('Set a username in your profile to reply.');
    const post = await prisma.feedPost.findFirst({ where: { id: postId, hiddenAt: null }, select: { id: true, userId: true } });
    if (!post) throw new NotFoundException('That post is gone.');
    const cooled = await this.redis.set(`kamby:feed:reply:${me}`, '1', 'EX', FEED_LIMITS.replyCooldownSeconds, 'NX').catch(() => 'OK');
    if (cooled !== 'OK') throw new HttpException('Slow down a little.', HttpStatus.TOO_MANY_REQUESTS);
    const [row] = await prisma.$transaction([
      prisma.feedReply.create({ data: { postId, userId: me, body }, include: { user: AUTHOR } }),
      prisma.feedPost.update({ where: { id: postId }, data: { replyCount: { increment: 1 } } }),
    ]);
    void this.notifications.notifyFeed({ ownerId: post.userId, actorId: me, kind: 'reply', postId, dedupe: `feedreply:${row.id}`, preview: body.slice(0, 80) }).catch(() => undefined);
    return { id: row.id, author: author(row.user), body: row.body, mine: true, createdAt: row.createdAt.toISOString() };
  }

  /** One report per person; the third hides the post for everyone. */
  async report(me: string, postId: string): Promise<{ hidden: boolean }> {
    const post = await prisma.feedPost.findUnique({ where: { id: postId }, select: { userId: true, hiddenAt: true } });
    if (!post) throw new NotFoundException('That post is gone.');
    if (post.userId === me) throw new BadRequestException("You can't report your own post — delete it instead.");
    const created = await prisma.feedReport.createMany({ data: [{ postId, userId: me }], skipDuplicates: true });
    if (created.count === 0) return { hidden: Boolean(post.hiddenAt) };
    const after = await prisma.feedPost.update({ where: { id: postId }, data: { reportCount: { increment: 1 } }, select: { reportCount: true } });
    if (after.reportCount >= FEED_LIMITS.reportsToHide && !post.hiddenAt) {
      await prisma.feedPost.update({ where: { id: postId }, data: { hiddenAt: new Date() } });
      return { hidden: true };
    }
    return { hidden: Boolean(post.hiddenAt) };
  }

  async remove(me: string, postId: string): Promise<void> {
    const res = await prisma.feedPost.updateMany({ where: { id: postId, userId: me, hiddenAt: null }, data: { hiddenAt: new Date() } });
    if (res.count === 0) throw new NotFoundException('That post is gone.');
  }

  private toDto(row: Prisma.FeedPostGetPayload<{ include: { user: typeof AUTHOR } }> & { likes?: { userId: string }[] }, me: string | null): FeedPost {
    const kind = (row.kind === 'trade' || row.kind === 'pnl' || row.kind === 'photo' || row.kind === 'video' ? row.kind : 'text') as FeedPost['kind'];
    return {
      id: row.id,
      author: author(row.user),
      body: row.body,
      kind,
      trade: kind === 'trade' ? (row.data as unknown as DmTrade) : null,
      pnl: kind === 'pnl' ? (row.data as unknown as DmPnl) : null,
      photo: kind === 'photo' ? (row.data as unknown as FeedPhoto) : null,
      video: kind === 'video' ? (row.data as unknown as FeedVideo) : null,
      likeCount: Math.max(0, row.likeCount),
      replyCount: row.replyCount,
      likedByMe: Boolean(row.likes?.length),
      mine: row.userId === me,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
