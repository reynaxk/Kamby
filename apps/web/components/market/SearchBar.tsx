'use client';

import { CHAIN_REGISTRY, DEFAULT_CHAIN_SLUG, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fetchSearchResults } from '@/lib/market-client';
import { formatPrice } from '@/lib/format';
import { TokenIdentity } from './TokenIdentity';
import { WatchButton } from './WatchButton';

const DEBOUNCE_MS = 250;

/**
 * Debounced live-typeahead dropdown over the results a full search would show, plus a
 * quick-Watch star per row — added so finding and watching a token doesn't require a full
 * page round trip through `/?search=...` first. That full search still works exactly as
 * before (Enter, or the form's own submit) for the complete server-rendered results page
 * (which also covers trader results — this dropdown is tokens-only, a fast path, not a
 * replacement). GET /market/search is public and cheap but throttled tighter than the API
 * default specifically for a debounced input (see market.controller.ts's own comment), so
 * this always debounces and cancels stale in-flight requests rather than firing on every
 * keystroke.
 */
export function SearchBar({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');
  const [results, setResults] = useState<MarketSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const term = value.trim();
    if (term.length === 0) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(() => {
      fetchSearchResults(term, 6)
        .then((rows) => {
          if (!cancelled) setResults(rows);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const showDropdown = isOpen && results.length > 0;

  return (
    <form
      ref={rootRef}
      action="/"
      method="get"
      role="search"
      className="relative w-full max-w-xs"
      onSubmit={() => setIsOpen(false)}
    >
      <label htmlFor="market-search" className="sr-only">
        Search tokens by symbol, name, or contract address
      </label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 transition-colors focus-within:border-accent">
        <svg aria-hidden width="15" height="15" viewBox="0 0 15 15" className="shrink-0 text-ink-400">
          <circle cx="6.5" cy="6.5" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <line x1="10.2" y1="10.2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          id="market-search"
          name="search"
          type="text"
          placeholder="Search token or address"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          autoComplete="off"
          className="w-full bg-transparent font-body text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none"
        />
      </div>

      {showDropdown && (
        <div
          aria-label="Search results"
          className="absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          {results.map((market) => {
            const chainSlug = slugForIdentifier(market.chainIdentifier) ?? DEFAULT_CHAIN_SLUG;
            return (
              <div
                key={`${market.chainIdentifier}:${market.tokenAddress}`}
                className="flex items-center gap-2 border-b border-line px-3 py-2 last:border-b-0 hover:bg-surface-raised"
              >
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    router.push(`/market/${chainSlug}/${market.tokenAddress}`);
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                >
                  <TokenIdentity symbol={market.symbol} name={market.name} logoUrl={market.logoUrl} size="sm" />
                  <span className="shrink-0 font-mono text-xs tabular-nums text-ink-600">
                    {formatPrice(market.priceUsd)}
                  </span>
                </button>
                <WatchButton
                  address={market.tokenAddress}
                  chainId={CHAIN_REGISTRY[chainSlug].numericId}
                  initialWatching={null}
                  compact
                />
              </div>
            );
          })}
        </div>
      )}
    </form>
  );
}
