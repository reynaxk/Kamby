'use client';

import { useEffect, useState } from 'react';
import { Globe, MessageCircle, Send } from 'lucide-react';
import type { TokenInfo, TokenInfoChain } from '@kamby/domain';
import { clientEnv } from '@/lib/env';
import { useTranslations } from 'next-intl';

/** One fetch per coin per page load, shared by every card showing it. */
const cache = new Map<string, Promise<TokenInfo | null>>();

function fetchTokenInfo(chain: TokenInfoChain, address: string): Promise<TokenInfo | null> {
  const key = `${chain}:${address}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetch(`${clientEnv.NEXT_PUBLIC_API_BASE_URL}/v1/market/token-info/${chain}/${encodeURIComponent(address)}`)
      .then((res) => (res.ok ? (res.json() as Promise<TokenInfo>) : null))
      .catch(() => null);
    cache.set(key, pending);
    // A failed lookup isn't remembered, so the next coin view tries again.
    void pending.then((info) => info === null && cache.delete(key));
  }
  return pending;
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Website';
  }
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M18.244 2H21.5l-7.5 8.57L22.75 22h-6.86l-5.37-7.02L4.4 22H1.14l8.02-9.17L.75 2h7.03l4.85 6.41L18.24 2Zm-1.2 18h1.8L6.98 3.9H5.05L17.04 20Z" />
    </svg>
  );
}

/**
 * A coin's website and socials for the About card (user request 2026-09-30). The links are
 * project-submitted (GeckoTerminal / DexScreener, already filtered to https server-side),
 * not checked by Kamby — the footnote says so, and they open in a new tab without referrer
 * or opener. Renders nothing until there's something real to show.
 */
export function TokenLinks({
  chain,
  address,
  showDescription = true,
  cardTitle,
}: {
  chain: TokenInfoChain;
  address: string;
  showDescription?: boolean;
  /** Set on pages without an About card: renders its own card, only once there's content. */
  cardTitle?: string;
}) {
  const tU = useTranslations('ui');
  const [info, setInfo] = useState<TokenInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    void fetchTokenInfo(chain, address).then((result) => !cancelled && setInfo(result));
    return () => {
      cancelled = true;
    };
  }, [chain, address]);

  if (!info) return null;
  const links: { href: string; label: string; icon: React.ReactNode }[] = [
    ...info.websites.map((href) => ({ href, label: hostLabel(href), icon: <Globe className="h-3.5 w-3.5" aria-hidden /> })),
    ...(info.twitterUrl ? [{ href: info.twitterUrl, label: 'X', icon: <XIcon className="h-3 w-3" /> }] : []),
    ...(info.telegramUrl ? [{ href: info.telegramUrl, label: 'Telegram', icon: <Send className="h-3.5 w-3.5" aria-hidden /> }] : []),
    ...(info.discordUrl ? [{ href: info.discordUrl, label: 'Discord', icon: <MessageCircle className="h-3.5 w-3.5" aria-hidden /> }] : []),
  ];
  const description = showDescription ? info.description : null;
  if (links.length === 0 && !description) return null;

  const body = (
    <>
      {description && <p className="line-clamp-3 font-body text-xs leading-relaxed text-ink-600" title={description}>{description}</p>}
      {links.length > 0 && (
        <div className={`flex flex-wrap gap-1.5 ${description ? 'mt-2' : ''}`}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex max-w-[11rem] items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2.5 py-1 font-body text-xs text-ink-900 transition-colors hover:border-accent/60 hover:text-accent"
            >
              {link.icon}
              <span className="truncate">{link.label}</span>
            </a>
          ))}
        </div>
      )}
      <p className="mt-1.5 font-body text-[0.6rem] text-ink-400">{tU('linksAreProvidedByThe_b114')}</p>
    </>
  );
  if (cardTitle) {
    return (
      <section className="mt-3 rounded-2xl border border-line bg-surface p-3.5">
        <h3 className="mb-2 font-display text-sm font-bold text-ink-900">{cardTitle}</h3>
        {body}
      </section>
    );
  }
  return <div className="mt-2.5 border-t border-line pt-2.5">{body}</div>;
}
