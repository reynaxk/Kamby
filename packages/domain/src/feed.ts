import type { DmPnl, DmTrade } from './dm';

/**
 * The Feed (2026-10-30, owner's concepts): short posts by traders, optionally with a Trade Card
 * or a PnL card built by the server from the poster's real position. Same rules as Pulse —
 * a username, no links — plus a slower cooldown, since a post stays up.
 */
export const FEED_LIMITS = {
  maxLength: 500,
  replyMaxLength: 280,
  /** One post per this many seconds per user. */
  cooldownSeconds: 30,
  replyCooldownSeconds: 5,
  pageSize: 20,
  repliesPageSize: 50,
  /** This many reports from different people hide a post. */
  reportsToHide: 3,
  /** Photos (2026-10-30): every one checked by Sightengine first. No daily caps (owner, 10-30). */
  photoMaxBytes: 5 * 1024 * 1024,
  /** Videos (2026-10-30): short clips, every 3rd second checked by Sightengine. */
  videoMaxBytes: 20 * 1024 * 1024,
  videoMaxSeconds: 15,
} as const;

export type FeedTab = 'foryou' | 'following';
export type FeedPostKind = 'text' | 'trade' | 'pnl' | 'photo' | 'video';

export interface FeedPhoto {
  url: string;
}

export interface FeedVideo {
  url: string;
}

export interface FeedAuthor {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  /** Their profile lives at /trader/<address>. */
  address: string | null;
}

export interface FeedPost {
  id: string;
  author: FeedAuthor;
  body: string;
  kind: FeedPostKind;
  trade: DmTrade | null;
  pnl: DmPnl | null;
  photo: FeedPhoto | null;
  video: FeedVideo | null;
  likeCount: number;
  replyCount: number;
  likedByMe: boolean;
  mine: boolean;
  createdAt: string;
}

export interface FeedPage {
  items: FeedPost[];
  /** Pass as `before` for the next page; null at the end. */
  nextBefore: string | null;
}

export interface FeedReply {
  id: string;
  author: FeedAuthor;
  body: string;
  mine: boolean;
  createdAt: string;
}
