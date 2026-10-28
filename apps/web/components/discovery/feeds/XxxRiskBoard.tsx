'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { XxxRiskFlag, XxxRiskToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { cashtag, formatCompactUsd, formatPercent, truncateAddress } from '@/lib/format';

type Sort = 'new' | 'vol' | 'mc';

interface Filters {
  maxAgeMin: number | null;
  mcMin: number | null;
  mcMax: number | null;
  liqMin: number | null;
  volMin: number | null;
  holdersMin: number | null;
  hideMint: boolean;
  hideDev: boolean;
  auditedOnly: boolean;
  socialsOnly: boolean;
}

const NO_FILTERS: Filters = { maxAgeMin: null, mcMin: null, mcMax: null, liqMin: null, volMin: null, holdersMin: null, hideMint: false, hideDev: false, auditedOnly: false, socialsOnly: false };
const STORE_KEY = 'kamby:xxxrisk-view';

const CHOICES = {
  maxAgeMin: [1, 3, 5],
  mcMin: [5_000, 10_000, 20_000],
  mcMax: [15_000, 30_000],
  liqMin: [1_000, 3_000],
  volMin: [500, 2_000, 5_000],
  holdersMin: [10, 25, 50],
} as const;

const FLAG_KEY: Record<XxxRiskFlag, string> = {
  mintable: 'flagMint',
  freezable: 'flagFreeze',
  'dev-holds-over-20pct': 'flagDev',
  'top-holders-over-50pct': 'flagTop',
  'unverified-audit': 'flagNoAudit',
};

function loadView(): { sort: Sort; filters: Filters } {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as { sort?: Sort; filters?: Partial<Filters> };
      return { sort: v.sort ?? 'new', filters: { ...NO_FILTERS, ...v.filters } };
    }
  } catch {
    // a fresh view
  }
  return { sort: 'new', filters: NO_FILTERS };
}

function activeCount(f: Filters): number {
  return (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((k) => f[k] !== NO_FILTERS[k]).length;
}

function passes(t: XxxRiskToken, f: Filters, ageS: number): boolean {
  if (f.maxAgeMin !== null && ageS > f.maxAgeMin * 60) return false;
  if (f.mcMin !== null && t.marketCapUsd < f.mcMin) return false;
  if (f.mcMax !== null && t.marketCapUsd > f.mcMax) return false;
  if (f.liqMin !== null && t.liquidityUsd < f.liqMin) return false;
  if (f.volMin !== null && (t.volume5mUsd ?? 0) < f.volMin) return false;
  if (f.holdersMin !== null && (t.holders ?? 0) < f.holdersMin) return false;
  if (f.hideMint && (t.riskFlags.includes('mintable') || t.riskFlags.includes('freezable'))) return false;
  if (f.hideDev && t.riskFlags.includes('dev-holds-over-20pct')) return false;
  if (f.auditedOnly && t.riskFlags.includes('unverified-audit')) return false;
  if (f.socialsOnly && !(t.socials && Object.keys(t.socials).length > 0)) return false;
  return true;
}

function ageText(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/**
 * XXXRisk as a live card grid (owner 2026-10-28: "like GMGN — appearing fast, newest ones in
 * cubes with data, customizable filters"). Newest first by default; a coin that just arrived
 * drops in with a brief accent edge. Hovering the grid (mouse only) pauses it so a card
 * doesn't move under the pointer. Sort and filters are remembered on this device.
 */
export function XxxRiskBoard({ tokens, emptyText }: { tokens: XxxRiskToken[]; emptyText: string }) {
  const t = useTranslations('xxxrisk');
  const [view, setView] = useState<{ sort: Sort; filters: Filters }>({ sort: 'new', filters: NO_FILTERS });
  const [sheet, setSheet] = useState(false);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const frozen = useRef<XxxRiskToken[] | null>(null);
  // When each coin launched (ms), and when this screen first saw it — new arrivals animate,
  // the first load doesn't.
  const launchedAt = useRef(new Map<string, number>());
  const firstSeen = useRef(new Map<string, number>());
  const openedAt = useRef(Date.now());

  useEffect(() => setView(loadView()), []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  function update(next: Partial<{ sort: Sort; filters: Filters }>) {
    setView((v) => {
      const merged = { ...v, ...next };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(merged));
      } catch {
        // remembered for this visit only
      }
      return merged;
    });
  }

  if (!paused) frozen.current = null;
  else if (!frozen.current) frozen.current = tokens;
  const source = paused && frozen.current ? frozen.current : tokens;

  for (const token of source) {
    if (!launchedAt.current.has(token.mintAddress)) launchedAt.current.set(token.mintAddress, token.createdAtMs ?? Date.now() - token.ageSeconds * 1000);
    if (!firstSeen.current.has(token.mintAddress)) firstSeen.current.set(token.mintAddress, Date.now());
  }
  const ageOf = (token: XxxRiskToken) => Math.max(0, Math.round((now - (launchedAt.current.get(token.mintAddress) ?? now)) / 1000));

  const shown = useMemo(() => {
    const list = source.filter((token) => passes(token, view.filters, ageOf(token)));
    if (view.sort === 'vol') list.sort((a, b) => (b.volume5mUsd ?? 0) - (a.volume5mUsd ?? 0));
    else if (view.sort === 'mc') list.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
    else list.sort((a, b) => (launchedAt.current.get(b.mintAddress) ?? 0) - (launchedAt.current.get(a.mintAddress) ?? 0));
    return list;
  }, [source, view, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = activeCount(view.filters);
  const preview = source.filter((token) => passes(token, view.filters, ageOf(token))).length;

  return (
    <div className="col-span-full">
      <div className="flex items-center gap-2 px-2 py-2 md:px-3">
        <span className="flex items-center gap-1.5 font-body text-xs font-semibold text-ink-600">
          <span className={cn('h-1.5 w-1.5 rounded-full', paused ? 'bg-ink-400' : 'bg-up animate-pulse')} aria-hidden />
          {paused ? t('paused') : t('live', { n: shown.length })}
        </span>
        <div className="ml-auto flex items-center gap-1 rounded-xl bg-white/[0.04] p-0.5" role="group" aria-label={t('sort')}>
          {(['new', 'vol', 'mc'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={view.sort === s}
              onClick={() => update({ sort: s })}
              className={cn('h-7 rounded-lg px-2.5 font-display text-xs font-bold transition-colors', view.sort === s ? 'bg-white/[0.1] text-ink-900' : 'text-ink-400 hover:text-ink-900')}
            >
              {t(s === 'new' ? 'sortNew' : s === 'vol' ? 'sortVol' : 'sortMc')}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSheet(true)}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-xl border px-2.5 font-display text-xs font-bold transition-colors',
            count > 0 ? 'border-accent/50 bg-accent/10 text-accent' : 'border-white/10 bg-white/[0.04] text-ink-900 hover:border-white/20',
          )}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {t('filters')}
          {count > 0 && <span className="rounded-md bg-accent px-1 text-[0.65rem] text-black">{count}</span>}
        </button>
      </div>

      {tokens.length === 0 ? (
        <p className="p-3 font-body text-xs text-ink-400">{emptyText}</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
          <p className="font-body text-sm text-ink-400">{t('noMatch')}</p>
          <button type="button" onClick={() => update({ filters: NO_FILTERS })} className="h-9 rounded-xl bg-white/[0.06] px-4 font-display text-xs font-bold text-ink-900">
            {t('reset')}
          </button>
        </div>
      ) : (
        <ul
          className="grid grid-cols-2 gap-2 px-2 pb-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] md:px-3"
          onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
          onPointerLeave={() => setPaused(false)}
        >
          {shown.map((token) => (
            <XxxRiskCard
              key={token.mintAddress}
              token={token}
              ageS={ageOf(token)}
              fresh={(firstSeen.current.get(token.mintAddress) ?? 0) - openedAt.current > 1_500}
            />
          ))}
        </ul>
      )}

      <MobileDrawer open={sheet} onClose={() => setSheet(false)} title={t('filters')} desktop>
        <FilterSheet filters={view.filters} onChange={(filters) => update({ filters })} matching={preview} onDone={() => setSheet(false)} />
      </MobileDrawer>
    </div>
  );
}

function XxxRiskCard({ token, ageS, fresh }: { token: XxxRiskToken; ageS: number; fresh: boolean }) {
  const t = useTranslations('xxxrisk');
  const curve = Math.max(0, Math.min(100, token.curvePct ?? 0));
  const change = token.priceChange5mPct ?? null;
  const buys = token.buys5m ?? null;
  const sells = token.sells5m ?? null;
  const socials = token.socials ?? {};
  const label = token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress);
  return (
    <li className={cn(fresh && 'kamby-card-in')}>
      <Link
        href={`/solana?mint=${encodeURIComponent(token.mintAddress)}`}
        className="group flex h-full flex-col gap-2 rounded-2xl border border-white/[0.07] bg-surface p-2.5 transition-colors hover:border-white/20 hover:bg-surface-raised"
      >
        <span className="flex items-start gap-2">
          <span
            className="relative shrink-0 rounded-full p-[2px]"
            style={{ background: `conic-gradient(rgb(var(--kamby-accent)) ${curve * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
            title={t('curve', { pct: Math.round(curve) })}
          >
            <TokenAvatar src={token.imageUrl} seed={token.mintAddress} label={token.symbol ?? token.name} className="h-10 w-10 border-2 border-surface text-[0.85rem]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <span className="truncate font-display text-[0.9rem] font-bold text-ink-900">{label}</span>
              <span className={cn('ml-auto shrink-0 font-mono text-[0.7rem] font-semibold tabular-nums', ageS < 60 ? 'text-accent' : 'text-ink-400')}>{ageText(ageS)}</span>
            </span>
            <span className="block truncate font-body text-[0.7rem] text-ink-400">{token.name ?? truncateAddress(token.mintAddress)}</span>
          </span>
        </span>

        <span className="flex items-baseline justify-between gap-1">
          <span className="font-display text-base font-extrabold tabular-nums text-ink-900">
            <span className="mr-1 font-body text-[0.62rem] font-semibold text-ink-400">MC</span>
            {formatCompactUsd(token.marketCapUsd)}
          </span>
          {change !== null && <span className={cn('font-mono text-[0.72rem] font-semibold tabular-nums', change >= 0 ? 'text-up' : 'text-down')}>{formatPercent(change)}</span>}
        </span>

        <span className="grid grid-cols-3 gap-1 font-mono text-[0.66rem] tabular-nums">
          <Stat label={t('vol')} value={formatCompactUsd(token.volume5mUsd)} />
          <Stat label={t('holders')} value={token.holders != null ? String(token.holders) : '—'} />
          <Stat label={t('liq')} value={formatCompactUsd(token.liquidityUsd)} />
        </span>

        {buys !== null && sells !== null && buys + sells > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-[0.62rem] tabular-nums" title={t('buysSells')}>
            <span className="text-up">{buys}</span>
            <span className="flex h-1 flex-1 overflow-hidden rounded-full bg-down/50">
              <span className="h-full bg-up" style={{ width: `${(buys / (buys + sells)) * 100}%` }} />
            </span>
            <span className="text-down">{sells}</span>
          </span>
        )}

        <span className="mt-auto flex flex-wrap items-center gap-1">
          {socials.twitter && <SocialDot kind="x" />}
          {socials.telegram && <SocialDot kind="tg" />}
          {socials.website && <SocialDot kind="web" />}
          {token.riskFlags.map((f) => (
            <span key={f} className="rounded-md bg-down/15 px-1 py-px font-body text-[0.6rem] font-semibold text-down">
              {t(FLAG_KEY[f])}
            </span>
          ))}
          {token.riskFlags.length === 0 && <span className="rounded-md bg-up/15 px-1 py-px font-body text-[0.6rem] font-semibold text-up">{t('flagClean')}</span>}
        </span>
      </Link>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded-lg bg-white/[0.035] px-1.5 py-1">
      <span className="block truncate font-body text-[0.58rem] text-ink-400">{label}</span>
      <span className="block truncate font-semibold text-ink-900">{value}</span>
    </span>
  );
}

function SocialDot({ kind }: { kind: 'x' | 'tg' | 'web' }) {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-md bg-white/[0.06] text-ink-600" aria-label={kind === 'x' ? 'X' : kind === 'tg' ? 'Telegram' : 'Website'}>
      {kind === 'x' ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.2 2H21l-6.5 7.4L22 22h-6l-4.7-6.1L5.8 22H3l7-8L2 2h6.1l4.2 5.6L18.2 2Z" />
        </svg>
      ) : kind === 'tg' ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M21.5 3.5 2.8 10.7c-1 .4-1 1.6.1 1.9l4.7 1.5 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.8 3.5c.7.5 1.6.1 1.8-.7l3-15c.2-1.1-.9-2-2-1.4ZM9.6 14.3l-.4 3.6-1.3-4 9.6-6.3-7.9 6.7Z" />
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      )}
    </span>
  );
}

function FilterSheet({ filters, onChange, matching, onDone }: { filters: Filters; onChange: (f: Filters) => void; matching: number; onDone: () => void }) {
  const t = useTranslations('xxxrisk');
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const row = (key: keyof typeof CHOICES, title: string, fmt: (v: number) => string) => (
    <div>
      <p className="mb-1.5 font-body text-xs font-semibold text-ink-400">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {[null, ...CHOICES[key]].map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={filters[key] === v}
            onClick={() => set({ [key]: v } as Partial<Filters>)}
            className={cn(
              'h-8 rounded-xl border px-3 font-display text-xs font-bold transition-colors',
              filters[key] === v ? 'border-accent/60 bg-accent/10 text-accent' : 'border-white/10 bg-white/[0.03] text-ink-900 hover:border-white/20',
            )}
          >
            {v === null ? t('any') : fmt(v)}
          </button>
        ))}
      </div>
    </div>
  );
  const toggle = (key: 'hideMint' | 'hideDev' | 'auditedOnly' | 'socialsOnly', title: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={filters[key]}
      onClick={() => set({ [key]: !filters[key] })}
      className="flex w-full items-center justify-between gap-3 py-2 text-left font-body text-sm text-ink-900"
    >
      {title}
      <span className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', filters[key] ? 'bg-accent' : 'bg-white/15')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform', filters[key] ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
  const usd = (v: number) => formatCompactUsd(v).replace('.0K', 'K');

  return (
    <div className="space-y-4">
      {row('maxAgeMin', t('maxAge'), (v) => t('underMin', { n: v }))}
      {row('mcMin', t('mcMin'), usd)}
      {row('mcMax', t('mcMax'), usd)}
      {row('liqMin', t('liqMin'), usd)}
      {row('volMin', t('volMin'), usd)}
      {row('holdersMin', t('holdersMin'), String)}
      <div>
        <p className="mb-0.5 font-body text-xs font-semibold text-ink-400">{t('safety')}</p>
        <div className="divide-y divide-white/[0.05]">
          {toggle('hideMint', t('hideMint'))}
          {toggle('hideDev', t('hideDev'))}
          {toggle('auditedOnly', t('auditedOnly'))}
          {toggle('socialsOnly', t('socialsOnly'))}
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2 pt-1">
        <button type="button" onClick={() => onChange(NO_FILTERS)} className="h-12 rounded-2xl bg-white/[0.06] px-5 font-display text-sm font-bold text-ink-900">
          {t('reset')}
        </button>
        <button type="button" onClick={onDone} className="h-12 rounded-2xl bg-accent font-display text-sm font-black text-black">
          {t('show', { n: matching })}
        </button>
      </div>
    </div>
  );
}
