'use client';

import { CHAIN_REGISTRY, slugForIdentifier, type MarketSummary } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { solanaMarketHref } from '@/lib/solana-links';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fetchPeopleResults, fetchSearchResults, type PersonResult } from '@/lib/market-client';
import { saveRecentSearch } from '@/lib/recent-searches';
import { cashtag, formatPercent, formatPrice } from '@/lib/format';
import { TokenAvatar } from './TokenAvatar';
import { badgeChainFor, ChainBadge } from './ChainBadge';
import { WatchButton } from './WatchButton';
import { DmAvatar } from '@/components/dm/DmAvatar';
import { useTranslations } from 'next-intl';

const DEBOUNCE_MS = 250;

/** A pasted contract / mint address (EVM 0x… or a Solana base58 mint). */
function looksLikeAddress(q: string): boolean {
  return /^0x[0-9a-f]{40}$/i.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
}
const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

type Hit = { kind: 'coin'; market: MarketSummary; href: string | null } | { kind: 'person'; person: PersonResult; href: string };

/**
 * Kamby's search (2026-10-18 redesign, owner: "it ain't aesthetic"): one glass field for coins
 * by name / symbol / contract address and people by @name or wallet. Results come in two
 * sections — Coins (logo + chain, price, 24h move) and People (avatar, @name, wallet) — with
 * arrow-key navigation, a "Paste" pill for addresses on phones, a clear ✕, and a quiet
 * spinner while it looks things up. `screen` (the Search tab) shows results in the page
 * instead of a dropdown and tells the page when a search is active.
 *
 * GET /market/search is public but throttled for a debounced input (see market.controller.ts),
 * so this always debounces and drops stale responses. Enter with nothing highlighted still
 * submits to the full results page, as before.
 */
export function SearchBar({ defaultValue, screen = false, onActiveChange }: { defaultValue?: string; screen?: boolean; onActiveChange?: (active: boolean) => void }) {
  const tU = useTranslations('ui');
  const tAuth = useTranslations('auth');
  const t = useTranslations('search');
  const router = useRouter();
  const [value, setValue] = useState(defaultValue ?? '');
  const [coins, setCoins] = useState<MarketSummary[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [canPaste, setCanPaste] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const term = value.trim();
  const address = looksLikeAddress(term);

  useEffect(() => {
    setCanPaste(typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function' && window.matchMedia('(pointer: coarse)').matches);
  }, []);

  useEffect(() => onActiveChange?.(term.length > 0), [term, onActiveChange]);

  useEffect(() => {
    setActive(-1);
    if (term.length === 0) {
      setCoins([]);
      setPeople([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    clearTimeout(debounceRef.current);
    let cancelled = false;
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const wantPeople = term.replace(/^@/, '').length >= 2 && !/^0x[0-9a-f]{40}$/i.test(term);
      Promise.all([
        term.startsWith('@') ? Promise.resolve([]) : fetchSearchResults(term, 6).catch(() => [] as MarketSummary[]),
        wantPeople ? Promise.resolve(fetchPeopleResults?.(term, 4)).then((r) => r ?? []).catch(() => [] as PersonResult[]) : Promise.resolve([] as PersonResult[]),
      ]).then(([c, p]) => {
        if (cancelled) return;
        setCoins(c);
        setPeople(p);
        setSearched(true);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [term]);

  useEffect(() => {
    if (!isOpen || screen) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen, screen]);

  const hits: Hit[] = [
    ...coins.map((market): Hit => {
      const slug = slugForIdentifier(market.chainIdentifier);
      const href = slug ? `/market/${slug}/${market.tokenAddress}` : market.chainIdentifier === 'solana' ? solanaMarketHref(market.tokenAddress) : null;
      return { kind: 'coin', market, href };
    }),
    ...people.map((person): Hit => ({ kind: 'person', person, href: `/trader/${person.address}` })),
  ];

  function open(hit: Hit) {
    if (!hit.href) return;
    if (hit.kind === 'coin') saveRecentSearch(hit.market);
    setIsOpen(false);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setIsOpen(true);
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0 && hits[active]) {
      e.preventDefault();
      open(hits[active]!);
    }
  }

  async function paste() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        setValue(text.slice(0, 100));
        setIsOpen(true);
        inputRef.current?.focus();
      }
    } catch {
      // permission refused — nothing to do
    }
  }

  const showResults = (screen || isOpen) && term.length > 0 && (loading || searched);

  const results = (
    <div
      aria-label={tU('searchResults_eb6b')}
      className={cn(
        screen
          ? 'mt-3'
          : // Solid (not see-through) and wider than the header field, so nothing underneath shows through.
            'absolute right-0 z-[60] mt-2 max-h-[70vh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-3xl border border-white/10 bg-[#0B0F18] p-2 shadow-[0_22px_54px_rgba(0,0,0,0.7)]',
      )}
    >
      {address && (
        <p className="mx-1 mb-2 flex items-center gap-2 rounded-2xl border border-accent/20 bg-accent/[0.06] px-3 py-2 font-body text-[0.72rem] text-ink-600">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-accent" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
            </svg>
          </span>
          {t('addressNote')}
        </p>
      )}

      {loading && !searched ? (
        <ul className="space-y-1 px-1 py-1">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
              <span className="h-10 w-10 animate-pulse rounded-full bg-white/[0.06]" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-3 w-24 animate-pulse rounded-full bg-white/[0.07]" />
                <span className="block h-2.5 w-36 animate-pulse rounded-full bg-white/[0.04]" />
              </span>
              <span className="h-3 w-14 animate-pulse rounded-full bg-white/[0.05]" />
            </li>
          ))}
        </ul>
      ) : hits.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-ink-400" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5M8.5 11h5" />
            </svg>
          </span>
          <p className="mt-3 font-display text-sm font-bold text-ink-900">{t('nothing', { q: term.length > 24 ? `${term.slice(0, 22)}…` : term })}</p>
          <p className="mt-1 max-w-xs font-body text-xs text-ink-400">{t('nothingHint')}</p>
        </div>
      ) : (
        <>
          {coins.length > 0 && <SectionTitle label={t('coins')} />}
          <ul>
            {hits.map((hit, i) => {
              if (hit.kind !== 'coin') return null;
              const m = hit.market;
              const chain = badgeChainFor(m.chainIdentifier);
              const slug = slugForIdentifier(m.chainIdentifier);
              const up = (m.priceChange24hPct ?? 0) >= 0;
              const row = (
                <>
                  <span className="relative shrink-0">
                    <TokenAvatar src={m.logoUrl} seed={m.tokenAddress} label={m.symbol ?? m.tokenAddress} className="h-10 w-10 text-xs" />
                    {chain && <ChainBadge chain={chain} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[0.95rem] font-bold text-ink-900">{cashtag(m.symbol ?? m.tokenAddress.slice(0, 6))}</span>
                    <span className="block truncate font-body text-xs text-ink-400">{m.name ?? shortAddr(m.tokenAddress)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-sm font-bold tabular-nums text-ink-900">{formatPrice(m.priceUsd)}</span>
                    {m.priceChange24hPct !== null && m.priceChange24hPct !== undefined && (
                      <span className={cn('block font-body text-[0.7rem] font-semibold tabular-nums', up ? 'text-up' : 'text-down')}>{formatPercent(m.priceChange24hPct)}</span>
                    )}
                  </span>
                </>
              );
              return (
                <li key={`${m.chainIdentifier}:${m.tokenAddress}`} className={cn('flex items-center gap-1 rounded-2xl pr-1 transition-colors', i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]')}>
                  {hit.href ? (
                    <button type="button" onMouseEnter={() => setActive(i)} onClick={() => open(hit)} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2.5 text-left">
                      {row}
                    </button>
                  ) : (
                    <div title={tU('thisMarketIsVisibleFor_626f')} className="flex min-w-0 flex-1 cursor-not-allowed items-center gap-3 px-2 py-2.5 opacity-60">
                      {row}
                    </div>
                  )}
                  {slug && <WatchButton address={m.tokenAddress} chainId={CHAIN_REGISTRY[slug].numericId} initialWatching={null} compact />}
                </li>
              );
            })}
          </ul>
          {people.length > 0 && <SectionTitle label={t('people')} />}
          <ul>
            {hits.map((hit, i) => {
              if (hit.kind !== 'person') return null;
              const p = hit.person;
              return (
                <li key={p.address}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => open(hit)}
                    className={cn('flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors', i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]')}
                  >
                    <DmAvatar name={p.username} src={p.avatarUrl} className="h-10 w-10 text-sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[0.95rem] font-bold text-ink-900">{p.username ? `@${p.username}` : shortAddr(p.address)}</span>
                      <span className="block truncate font-body text-xs text-ink-400">{shortAddr(p.address)}</span>
                    </span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-ink-400" aria-hidden>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <form
      ref={rootRef}
      action="/terminal"
      method="get"
      role="search"
      className="relative w-full max-w-none"
      onSubmit={(e) => {
        if (screen) e.preventDefault();
        setIsOpen(false);
      }}
    >
      <label htmlFor={screen ? 'screen-search' : 'market-search'} className="sr-only">
        {tU('searchTokensBySymbolName_383c')}
      </label>
      <div
        className={cn(
          'group flex items-center gap-2.5 border transition-colors',
          screen ? 'kamby-glass-solid h-14 rounded-[1.4rem] px-4' : 'h-10 rounded-2xl bg-white/[0.04] px-3',
          'border-white/10 focus-within:border-accent/50 focus-within:bg-white/[0.06]',
        )}
      >
        <svg aria-hidden width={screen ? 18 : 15} height={screen ? 18 : 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" className="shrink-0 text-ink-400 transition-colors group-focus-within:text-accent">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          id={screen ? 'screen-search' : 'market-search'}
          name="search"
          type="text"
          enterKeyHint="search"
          placeholder={screen ? t('placeholder') : tAuth('searchPlaceholder')}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cn('w-full min-w-0 bg-transparent font-body text-ink-900 placeholder:text-ink-400 focus:outline-none', screen ? 'text-base' : 'text-sm')}
        />
        {loading && <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/15 border-t-accent" aria-hidden />}
        {value ? (
          <button
            type="button"
            aria-label={t('clear')}
            onClick={() => {
              setValue('');
              inputRef.current?.focus();
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-ink-600 transition-colors hover:bg-white/15"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          screen &&
          canPaste && (
            <button type="button" onClick={() => void paste()} className="shrink-0 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-display text-xs font-bold text-accent transition-transform active:scale-95">
              {t('paste')}
            </button>
          )
        )}
      </div>

      {showResults && results}
    </form>
  );
}

function SectionTitle({ label }: { label: string }) {
  return <p className="px-3 pb-1 pt-3 font-body text-[0.62rem] font-bold uppercase tracking-[0.16em] text-ink-400 first:pt-1">{label}</p>;
}
