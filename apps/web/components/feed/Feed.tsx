'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';
import { useTranslations } from 'next-intl';
import { FEED_LIMITS, type DmPnl, type FeedPost, type FeedReply, type FeedTab, type NewsItem } from '@kamby/domain';
import type { TokenPosition } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { cashtag, formatPercent, formatRelativeTime, formatSignedCompactUsd } from '@/lib/format';
import { friendlyError } from '@/lib/friendly-error';
import { marketHref } from '@/lib/solana-links';
import { useMyUsername } from '@/lib/use-my-username';
import {
  createFeedPost,
  deleteFeedPost,
  fetchFeed,
  fetchFeedReplies,
  FEED_ENABLED,
  fetchFeedCapabilities,
  uploadFeedPhoto,
  uploadFeedVideo,
  videoSeconds,
  likeFeedPost,
  replyToFeedPost,
  reportFeedPost,
} from '@/lib/feed-client';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { TradeCard } from '@/components/social/TradeCard';
import { PositionPicker } from '@/components/social/PositionPicker';
import { SafeImg } from '@/components/social/SafeImg';
import { NewsCard } from '@/components/news/NewsCard';
import { QuickBuyButton, QuickBuyProvider } from '@/components/trading/QuickBuy';
import { fetchNews } from '@/lib/news-client';
import { FeedCoinProvider, PostBody, useOpenCoin } from './FeedCoin';
import { mixNews } from './mix-news';

/**
 * The Feed (2026-10-30, owner's concepts): what traders post — a few lines, optionally with a
 * Trade Card or PnL card from their real position. For You / Following tabs, likes, replies,
 * report (three hide it) and delete your own. `address` shows one trader's posts (their profile).
 */
export function Feed({ address, composer = true, title, emptyText }: { address?: string; composer?: boolean; title?: string; emptyText?: string }) {
  const t = useTranslations('feed');
  const { authenticated } = usePrivy();
  const [tab, setTab] = useState<FeedTab>('foryou');
  const [items, setItems] = useState<FeedPost[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [news, setNews] = useState<NewsItem[]>([]);

  useEffect(() => {
    if (address) return;
    const controller = new AbortController();
    fetchNews({ limit: 12 }, controller.signal)
      .then((page) => setNews(page.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [address]);

  const load = useCallback(
    (which: FeedTab) => {
      if (!FEED_ENABLED) return setItems([]);
      setItems(null);
      setError(null);
      fetchFeed(which, null, address)
        .then((page) => {
          setItems(page.items);
          setNext(page.nextBefore);
        })
        .catch((err: unknown) => {
          setItems([]);
          setError(friendlyError(err));
        });
    },
    [address],
  );
  useEffect(() => load(tab), [tab, load]);

  async function more() {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(tab, next, address);
      setItems((cur) => [...(cur ?? []), ...page.items.filter((p) => !(cur ?? []).some((c) => c.id === p.id))]);
      setNext(page.nextBefore);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoadingMore(false);
    }
  }

  // For You: the latest headlines woven in, one after every few posts (2026-10-31).
  const mixed = useMemo(() => (items && !address && tab === 'foryou' ? mixNews(items, news) : (items ?? []).map((post) => ({ post }))), [items, news, address, tab]);

  if (!FEED_ENABLED && !address) return <p className="rounded-2xl border border-line bg-surface px-6 py-10 text-center font-body text-sm text-ink-600">{t('soon')}</p>;
  // A trader's profile: no section at all until they have posts (or when the feed can't load).
  if (address && (!items || items.length === 0)) {
    return items && emptyText ? <p className="rounded-2xl border border-line bg-surface px-6 py-8 text-center font-body text-sm text-ink-600">{emptyText}</p> : null;
  }

  const update = (p: FeedPost | null, id: string) => setItems((cur) => (cur ?? []).flatMap((x) => (x.id === id ? (p ? [p] : []) : [x])));

  return (
    <FeedCoinProvider>
    <QuickBuyProvider>
    <div className="flex flex-col gap-3">
      {title && <h2 className="font-display text-base font-bold text-ink-900">{title}</h2>}
      {composer && authenticated && <Composer onPosted={(p) => setItems((cur) => [p, ...(cur ?? [])])} />}
      {!address && (
        <div role="tablist" className="flex gap-1 self-start rounded-xl border border-line bg-surface p-1">
          {(['foryou', 'following'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn('h-8 rounded-lg px-3.5 font-display text-sm font-bold', tab === k ? 'bg-white/[0.08] text-ink-900' : 'text-ink-400')}
            >
              {t(k)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="rounded-xl bg-down/10 px-3 py-2 font-body text-sm text-down">{error}</p>}
      {items === null ? (
        [0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-surface" />)
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-5 py-6 text-center">
          <p className="font-display text-base font-bold text-ink-900">{tab === 'following' && !address ? t('emptyFollowing') : t('empty')}</p>
          <p className="mt-1 font-body text-sm text-ink-600">{t('emptyHint')}</p>
        </div>
      ) : (
        mixed.map((entry) => ('post' in entry ? <PostCard key={entry.post.id} post={entry.post} onChange={(np) => update(np, entry.post.id)} /> : <FeedNewsCard key={`news:${entry.news.id}`} item={entry.news} />))
      )}
      {next && items && items.length > 0 && (
        <button type="button" onClick={() => void more()} disabled={loadingMore} className="h-10 rounded-xl border border-line font-display text-sm font-bold text-ink-600 disabled:opacity-50">
          {loadingMore ? '…' : t('more')}
        </button>
      )}
    </div>
    </QuickBuyProvider>
    </FeedCoinProvider>
  );
}

/** A headline in the Feed: its coins open in place, each with a ⚡ quick buy. */
function FeedNewsCard({ item }: { item: NewsItem }) {
  const open = useOpenCoin();
  return (
    <NewsCard
      item={item}
      className="rounded-2xl px-4 py-3.5"
      onToken={open ? (tk) => open({ chainIdentifier: tk.chainIdentifier, tokenAddress: tk.tokenAddress, symbol: tk.symbol, logoUrl: null }) : undefined}
      tokenAction={(tk) => <QuickBuyButton chainIdentifier={tk.chainIdentifier} address={tk.tokenAddress} label={`$${tk.symbol}`} className="h-6 rounded-lg px-1.5 text-[0.7rem]" />}
    />
  );
}

function Composer({ onPosted }: { onPosted: (p: FeedPost) => void }) {
  const t = useTranslations('feed');
  const { authenticated } = usePrivy();
  const [username] = useMyUsername(authenticated);
  const [body, setBody] = useState('');
  const [attach, setAttach] = useState<{ kind: 'trade' | 'pnl'; position: TokenPosition } | null>(null);
  // A photo (2026-10-30): shown only when the server says moderation is on; checked on upload.
  const [photosOn, setPhotosOn] = useState(false);
  const [photo, setPhoto] = useState<{ photoId: string; url: string } | null>(null);
  const [videosOn, setVideosOn] = useState(false);
  const [video, setVideo] = useState<{ videoId: string; url: string } | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [checkingVideo, setCheckingVideo] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    fetchFeedCapabilities()
      .then((c) => {
        setPhotosOn(c.photos);
        setVideosOn(Boolean(c.videos));
      })
      .catch(() => setPhotosOn(false));
  }, []);

  async function pickVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.size > FEED_LIMITS.videoMaxBytes) return setError(t('videoTooBig'));
    const secs = await videoSeconds(file);
    if (Number.isFinite(secs) && secs > FEED_LIMITS.videoMaxSeconds + 0.5) return setError(t('videoTooLong', { seconds: FEED_LIMITS.videoMaxSeconds }));
    setUploading(true);
    setCheckingVideo(true);
    try {
      setVideo(await uploadFeedVideo(file));
      setPhoto(null);
      setAttach(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploading(false);
      setCheckingVideo(false);
      if (videoRef.current) videoRef.current.value = '';
    }
  }

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setPhoto(await uploadFeedPhoto(file));
      setVideo(null);
      setAttach(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  const [picking, setPicking] = useState<'trade' | 'pnl' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = !busy && !uploading && (body.trim().length > 0 || attach !== null || photo !== null || video !== null);

  async function submit() {
    if (!can) return;
    setBusy(true);
    setError(null);
    try {
      const chain = attach ? (attach.position.chainIdentifier ?? (attach.position.chain === 'solana' ? 'solana' : '')) : '';
      const p = await createFeedPost(
        body.trim(),
        video ? { kind: 'video', videoId: video.videoId } : photo ? { kind: 'photo', photoId: photo.photoId } : attach ? { kind: attach.kind, chain, tokenAddress: attach.position.tokenAddress } : undefined,
      );
      onPosted(p);
      setBody('');
      setAttach(null);
      setPhoto(null);
      setVideo(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (username === null) {
    return (
      <Link href="/account" className="rounded-2xl border border-line bg-surface p-4 font-body text-sm text-ink-600">
        {t('needUsername')}
      </Link>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <div className="flex gap-3">
        <DmAvatar name={username ?? null} src={null} className="h-10 w-10 shrink-0 text-sm" />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, FEED_LIMITS.maxLength))}
          placeholder={t('placeholder')}
          rows={2}
          aria-label={t('placeholder')}
          className="min-h-[3rem] flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2.5 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent/40 focus:outline-none"
        />
      </div>
      {video && (
        <div className="relative mt-2.5 overflow-hidden rounded-xl border border-line bg-black">
          <video src={video.url} controls playsInline className="max-h-80 w-full" />
          <button type="button" onClick={() => setVideo(null)} aria-label={t('removeCard')} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white">
            ✕
          </button>
        </div>
      )}
      {(photo || (uploading && !video)) && (
        <div className="relative mt-2.5 overflow-hidden rounded-xl border border-line bg-bg">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a checked upload on Kamby's own API
            <img src={photo.url} alt="" className="max-h-72 w-full object-cover" />
          ) : (
            <div className="flex h-28 items-center justify-center font-body text-xs text-ink-400">{t(checkingVideo ? 'checkingVideo' : 'checkingPhoto')}</div>
          )}
          {photo && (
            <button type="button" onClick={() => setPhoto(null)} aria-label={t('removeCard')} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white">
              ✕
            </button>
          )}
        </div>
      )}
      {attach && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-accent/20 bg-accent/[0.05] px-3 py-2">
          <TokenAvatar src={attach.position.logoUrl} seed={attach.position.tokenAddress} label={attach.position.symbol} className="h-6 w-6 text-[0.6rem]" />
          <span className="flex-1 truncate font-display text-xs font-bold text-ink-900">
            {attach.kind === 'trade' ? t('tradeCard') : t('pnlCard')} · {cashtag(attach.position.symbol ?? '')}
          </span>
          <button type="button" onClick={() => setAttach(null)} aria-label={t('removeCard')} className="text-ink-400 hover:text-ink-900">
            ✕
          </button>
        </div>
      )}
      {error && <p className="mt-2 font-body text-xs text-down">{error}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {photosOn && (
          <>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
            <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-display text-xs font-bold text-ink-600 hover:bg-white/[0.05] disabled:opacity-50">
              <span className="text-[#5CEFFF]">▣</span> {t('photo')}
            </button>
          </>
        )}
        {videosOn && (
          <>
            <input ref={videoRef} type="file" accept="video/mp4,video/webm,video/quicktime" className="hidden" onChange={(e) => void pickVideo(e.target.files?.[0])} />
            <button type="button" disabled={uploading} onClick={() => videoRef.current?.click()} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-display text-xs font-bold text-ink-600 hover:bg-white/[0.05] disabled:opacity-50">
              <span className="text-[#FF5CA8]">▶</span> {t('video')}
            </button>
          </>
        )}
        <button type="button" onClick={() => setPicking('trade')} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-display text-xs font-bold text-ink-600 hover:bg-white/[0.05]">
          <span className="text-accent">↗</span> {t('tradeCard')}
        </button>
        <button type="button" onClick={() => setPicking('pnl')} className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-display text-xs font-bold text-ink-600 hover:bg-white/[0.05]">
          <span className="text-[#FFC94D]">%</span> {t('pnlCard')}
        </button>
        <span className="ml-auto font-mono text-[0.65rem] text-ink-400">{body.length}/{FEED_LIMITS.maxLength}</span>
        <button type="button" disabled={!can} onClick={() => void submit()} className="h-9 rounded-xl bg-accent px-4 font-display text-sm font-black text-black disabled:opacity-40">
          {busy ? '…' : t('post')}
        </button>
      </div>
      <PositionPicker
        open={picking !== null}
        title={picking === 'pnl' ? t('pnlCard') : t('tradeCard')}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          if (picking) {
            setAttach({ kind: picking, position: p });
            setPhoto(null);
            setVideo(null);
          }
          setPicking(null);
        }}
      />
    </div>
  );
}

function PostCard({ post, onChange }: { post: FeedPost; onChange: (p: FeedPost | null) => void }) {
  const t = useTranslations('feed');
  const { authenticated, login } = usePrivy();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = post.author.username ?? '—';
  const profile = post.author.address ? `/trader/${post.author.address}` : null;

  async function like() {
    if (!authenticated) return login();
    const on = !post.likedByMe;
    onChange({ ...post, likedByMe: on, likeCount: post.likeCount + (on ? 1 : -1) });
    try {
      const r = await likeFeedPost(post.id, on);
      onChange({ ...post, likedByMe: r.likedByMe, likeCount: r.likeCount });
    } catch (err) {
      onChange(post);
      setError(friendlyError(err));
    }
  }

  async function act(kind: 'report' | 'delete') {
    setMenu(false);
    try {
      if (kind === 'delete') {
        await deleteFeedPost(post.id);
        onChange(null);
      } else {
        const r = await reportFeedPost(post.id);
        if (r.hidden) onChange(null);
        else setError(t('reported'));
      }
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  const who = (
    <>
      <DmAvatar name={post.author.username} src={post.author.avatarUrl} className="h-10 w-10 shrink-0 text-sm" />
      <span className="min-w-0">
        <span className="block truncate font-display text-sm font-bold text-ink-900">{name}</span>
        <span className="block font-body text-xs text-ink-400">{formatRelativeTime(post.createdAt)}</span>
      </span>
    </>
  );

  return (
    <article className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="flex items-center gap-3">
        {profile ? (
          <Link href={profile} className="flex min-w-0 flex-1 items-center gap-3">
            {who}
          </Link>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{who}</div>
        )}
        {authenticated && (
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} aria-label={t('more')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:bg-white/[0.05]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.7" />
                <circle cx="12" cy="12" r="1.7" />
                <circle cx="19" cy="12" r="1.7" />
              </svg>
            </button>
            {menu && (
              <div className="absolute right-0 top-9 z-20 w-36 rounded-xl border border-line bg-surface-raised p-1">
                <button type="button" onClick={() => void act(post.mine ? 'delete' : 'report')} className="w-full rounded-lg px-3 py-2 text-left font-display text-xs font-bold text-down hover:bg-white/[0.05]">
                  {post.mine ? t('delete') : t('report')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {post.body && <PostBody body={post.body} className="mt-2.5 whitespace-pre-wrap break-words font-body text-[0.92rem] leading-relaxed text-ink-900/90" />}
      {post.trade && <TradeCard trade={post.trade} mine={post.mine} by={`@${name}`} className="mt-3" />}
      {post.pnl && <PnlCard pnl={post.pnl} />}
      {post.video && <video src={post.video.url} controls playsInline preload="metadata" className="mt-3 max-h-[32rem] w-full rounded-xl border border-line bg-black" />}
      {post.photo && <SafeImg src={post.photo.url} className="mt-3 max-h-[32rem] w-full rounded-xl border border-line object-cover" fallback={null} />}
      {error && <p className="mt-2 font-body text-xs text-ink-400">{error}</p>}
      <div className="mt-3 flex items-center gap-5">
        <button type="button" onClick={() => void like()} aria-pressed={post.likedByMe} className={cn('flex items-center gap-1.5 font-display text-xs font-bold', post.likedByMe ? 'text-[#FF3B69]' : 'text-ink-400 hover:text-ink-900')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={post.likedByMe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11z" />
          </svg>
          {post.likeCount}
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 font-display text-xs font-bold text-ink-400 hover:text-ink-900">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5.2A8.5 8.5 0 1 1 21 11.5Z" />
          </svg>
          {post.replyCount}
        </button>
      </div>
      {open && <Replies post={post} onCount={(n) => onChange({ ...post, replyCount: n })} />}
    </article>
  );
}

function PnlCard({ pnl }: { pnl: DmPnl }) {
  const up = pnl.pnlUsd >= 0;
  const open = useOpenCoin();
  const href = marketHref(pnl.chainIdentifier, pnl.tokenAddress);
  const body = (
    <div className="mt-3 flex items-center gap-4 rounded-2xl border border-white/10 bg-[#040507] p-4">
      <TokenAvatar src={pnl.logoUrl} seed={pnl.tokenAddress} label={pnl.symbol} className="h-10 w-10 text-sm" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-ink-900">{cashtag(pnl.symbol ?? pnl.tokenAddress.slice(0, 6))}</p>
        <p className="font-mono text-xs text-ink-400">{formatSignedCompactUsd(pnl.pnlUsd)}</p>
      </div>
      <p className={cn('font-display text-3xl font-black tabular-nums tracking-tight', up ? 'text-up' : 'text-down')}>{formatPercent(pnl.pnlPct)}</p>
    </div>
  );
  // In the Feed the coin opens in place (chart + buy); elsewhere its page.
  if (open) {
    return (
      <button type="button" onClick={() => open({ chainIdentifier: pnl.chainIdentifier, tokenAddress: pnl.tokenAddress, symbol: pnl.symbol, logoUrl: pnl.logoUrl })} className="block w-full text-left">
        {body}
      </button>
    );
  }
  return href ? <Link href={href}>{body}</Link> : body;
}

function Replies({ post, onCount }: { post: FeedPost; onCount: (n: number) => void }) {
  const t = useTranslations('feed');
  const { authenticated } = usePrivy();
  const [items, setItems] = useState<FeedReply[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFeedReplies(post.id)
      .then(setItems)
      .catch(() => setItems([]));
  }, [post.id]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await replyToFeedPost(post.id, draft.trim());
      const nextItems = [...(items ?? []), r];
      setItems(nextItems);
      onCount(post.replyCount + 1);
      setDraft('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      {items === null ? (
        <div className="h-8 animate-pulse rounded-lg bg-white/[0.03]" />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {items.map((r) => (
            <li key={r.id} className="flex gap-2.5">
              <DmAvatar name={r.author.username} src={r.author.avatarUrl} className="h-7 w-7 shrink-0 text-[0.6rem]" />
              <p className="min-w-0 break-words font-body text-sm text-ink-900/90">
                <b className="mr-1.5 font-display">{r.author.username ?? '—'}</b>
                {r.body}
              </p>
            </li>
          ))}
        </ul>
      )}
      {authenticated && (
        <form onSubmit={(e) => void send(e)} className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, FEED_LIMITS.replyMaxLength))}
            placeholder={t('replyPlaceholder')}
            aria-label={t('replyPlaceholder')}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
          />
          <button type="submit" disabled={!draft.trim() || busy} className="h-9 rounded-lg bg-accent px-3 font-display text-xs font-black text-black disabled:opacity-40">
            {t('reply')}
          </button>
        </form>
      )}
      {error && <p className="mt-1.5 font-body text-xs text-down">{error}</p>}
    </div>
  );
}
