'use client';

import { useState } from 'react';
import Link from 'next/link';
import { newsSourceById, type NewsItem, type NewsToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { formatRelativeTime } from '@/lib/format';
import { marketHref } from '@/lib/solana-links';
import { useNow } from './useNow';

/** The publisher's own icon with its name beside it; a letter tile if the icon won't load. */
export function NewsSourceMark({ sourceId, className }: { sourceId: string; className?: string }) {
  const source = newsSourceById(sourceId);
  const [failed, setFailed] = useState(false);
  const name = source?.name ?? sourceId;
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      {source && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- tiny third-party favicon, nothing to optimise
        <img src={`${source.site}/favicon.ico`} alt="" width={16} height={16} loading="lazy" onError={() => setFailed(true)} className="h-4 w-4 shrink-0 rounded-[4px] bg-white/5" />
      ) : (
        <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-surface-raised font-display text-[0.6rem] font-bold text-ink-700">
          {name.charAt(0)}
        </span>
      )}
      <span className="truncate font-body text-xs font-semibold text-ink-700">{name}</span>
    </span>
  );
}

/** A tagged coin — opens its trading page by contract address, never by symbol. */
export function NewsTokenBadge({ token, onNavigate }: { token: NewsToken; onNavigate?: () => void }) {
  const href = marketHref(token.chainIdentifier, token.tokenAddress);
  const label = `$${token.symbol}`;
  const className = 'inline-flex items-center rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[0.7rem] font-semibold text-accent';
  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link href={href} onClick={onNavigate} className={cn(className, 'transition-colors hover:border-accent/60 hover:bg-accent/20')}>
      {label}
    </Link>
  );
}

/** One headline: source and time, the title (opens the article), a short summary, coin tags. */
export function NewsCard({ item, compact = false, className }: { item: NewsItem; compact?: boolean; className?: string }) {
  const now = useNow();
  return (
    <article className={cn('flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-white/15', className)}>
      <div className="flex items-center gap-2">
        <NewsSourceMark sourceId={item.sourceId} />
        <span aria-hidden className="text-ink-400">·</span>
        <time dateTime={item.publishedAt} className="shrink-0 font-body text-xs text-ink-400">
          {formatRelativeTime(item.publishedAt, now)}
        </time>
      </div>
      <a href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="font-display text-sm font-bold leading-snug text-ink-900 hover:text-accent">
        {item.title}
      </a>
      {!compact && item.summary && <p className="line-clamp-2 font-body text-xs leading-relaxed text-ink-400">{item.summary}</p>}
      {item.tokens.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {item.tokens.map((token) => (
            <NewsTokenBadge key={`${token.chainIdentifier}:${token.tokenAddress}`} token={token} />
          ))}
        </div>
      )}
    </article>
  );
}
