'use client';

import { useState } from 'react';
import Link from 'next/link';
import { newsSourceById, type NewsItem, type NewsToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { useNow } from './useNow';

/** The publisher's own icon with its name beside it; a letter tile if the icon won't load. */
export function NewsSourceMark({ sourceId, className, large = false }: { sourceId: string; className?: string; large?: boolean }) {
  const source = newsSourceById(sourceId);
  const [failed, setFailed] = useState(false);
  const name = source?.name ?? sourceId;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {source && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny third-party favicon, nothing to optimise
        <img src={`${source.site}/favicon.ico`} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} className={cn('shrink-0 rounded-[4px] bg-white/5', large ? 'h-5 w-5' : 'h-4 w-4')} />
      ) : (
        <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-[4px] bg-surface-raised font-display font-bold text-ink-700', large ? 'h-5 w-5 text-[0.7rem]' : 'h-4 w-4 text-[0.6rem]')}>
          {name.charAt(0)}
        </span>
      )}
      <span className={cn('truncate font-body font-semibold text-ink-700', large ? 'text-sm' : 'text-xs')}>{name}</span>
    </span>
  );
}

/** A tagged coin — opens its trading page by contract address, never by symbol (or, with
 *  `onOpen`, opens it in place — the Feed). */
export function NewsTokenBadge({ token, onNavigate, onOpen }: { token: NewsToken; onNavigate?: () => void; onOpen?: (token: NewsToken) => void }) {
  const href = marketHref(token.chainIdentifier, token.tokenAddress);
  const label = `$${token.symbol}`;
  const className = 'inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-accent';
  if (onOpen) {
    return (
      <button type="button" onClick={() => onOpen(token)} className={cn(className, 'transition-colors hover:border-accent/60 hover:bg-accent/20')}>
        {label}
      </button>
    );
  }
  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link href={href} onClick={onNavigate} className={cn(className, 'transition-colors hover:border-accent/60 hover:bg-accent/20')}>
      {label}
    </Link>
  );
}

/** One headline: source and time, the title (opens the article), a short summary, coin tags. */
export function NewsCard({
  item,
  compact = false,
  className,
  onToken,
  tokenAction,
  large = false,
}: {
  item: NewsItem;
  compact?: boolean;
  /** The News page: bigger type and more room (owner 2026-10-31). */
  large?: boolean;
  className?: string;
  /** Open a tagged coin in place instead of navigating to it. */
  onToken?: (token: NewsToken) => void;
  /** Something next to each coin tag (the Feed's ⚡ quick buy). */
  tokenAction?: (token: NewsToken) => React.ReactNode;
}) {
  const now = useNow();
  return (
    <article className={cn('flex flex-col rounded-xl border border-line bg-surface transition-colors hover:border-white/15', large ? 'gap-2.5 rounded-2xl px-5 py-[1.125rem] max-md:px-4 max-md:py-4' : 'gap-1.5 px-3.5 py-3', className)}>
      <div className="flex items-center gap-2">
        <NewsSourceMark sourceId={item.sourceId} large={large} />
        <span aria-hidden className="text-ink-400">·</span>
        <time dateTime={item.publishedAt} className={cn('shrink-0 font-body text-ink-400', large ? 'text-sm' : 'text-xs')}>
          {formatRelativeTime(item.publishedAt, now)}
        </time>
      </div>
      <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className={cn('font-display font-bold text-ink-900 hover:text-accent', large ? 'text-lg leading-snug max-md:text-[1.05rem]' : 'text-sm leading-snug')}>
        {item.title}
      </a>
      {!compact && item.summary && <p className={cn('font-body leading-relaxed text-ink-400', large ? 'line-clamp-3 text-[0.95rem] max-md:text-sm' : 'line-clamp-2 text-xs')}>{item.summary}</p>}
      {item.tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {item.tokens.map((token) => (
            <span key={`${token.chainIdentifier}:${token.tokenAddress}`} className="inline-flex items-center gap-1">
              <NewsTokenBadge token={token} onOpen={onToken} />
              {tokenAction?.(token)}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
