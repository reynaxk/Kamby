'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MIN_TRADE_USD, type XxxRiskFlag, type XxxRiskToken } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Loader2, Zap } from 'lucide-react';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { cashtag, formatCompactUsd, formatPercent, truncateAddress } from '@/lib/format';
import { useQuickSolanaBuy } from '@/lib/use-quick-solana-buy';

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

interface View {
  sort: Sort;
  filters: Filters;
  quickUsd: number;
}

const NO_FILTERS: Filters = { maxAgeMin: null, mcMin: null, mcMax: null, liqMin: null, volMin: null, holdersMin: null, hideMint: false, hideDev: false, auditedOnly: false, socialsOnly: false };
const DEFAULT_VIEW: View = { sort: 'new', filters: NO_FILTERS, quickUsd: 5 };
const STORE_KEY = 'kamby:xxxrisk-view';
const QUICK_PRESETS = [2, 5, 10, 25];

const CHOICES = {
  maxAgeMin: [1, 3, 5],
  mcMin: [5_000, 10_000, 20_000],
  mcMax: [15_000, 30_000],
  liqMin: [1_000, 3_000],
  volMin: [500, 2_000, 5_000],
  holdersMin: [10, 25, 50],
} as const;

/** Dev and top-holder shares show as numbers; these are the flags that have no number. */
const FLAG_KEY: Partial<Record<XxxRiskFlag, string>> = {
  mintable: 'flagMint',
  freezable: 'flagFreeze',
  'unverified-audit': 'flagNoAudit',
};

function loadView(): View {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<View> & { filters?: Partial<Filters> };
      return { sort: v.sort ?? 'new', filters: { ...NO_FILTERS, ...v.filters }, quickUsd: typeof v.quickUsd === 'number' && v.quickUsd > 0 ? v.quickUsd : DEFAULT_VIEW.quickUsd };
    }
  } catch {
    // a fresh view
  }
  return DEFAULT_VIEW;
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

/** "10k" → 10000, "1.5m" → 1500000, "250" → 250; anything else → null. Exported for tests. */
export function parseAmount(text: string): number | null {
  const m = /^\s*\$?\s*(\d+(?:[.,]\d+)?)\s*([km])?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.')) * (m[2]?.toLowerCase() === 'm' ? 1e6 : m[2] ? 1e3 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "$435" / "$9.3K" — whole dollars under $1K so a narrow card never truncates. */
function money(v: number | null): string {
  if (v !== null && Number.isFinite(v) && Math.abs(v) < 1_000) return `$${Math.round(v)}`;
  return formatCompactUsd(v).replace('.0K', 'K');
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
 * doesn't move under the pointer. Every card has ⚡ quick buy for the amount set in the bar.
 * Sort, filters and that amount are remembered on this device.
 */
export function XxxRiskBoard(props: { tokens: XxxRiskToken[]; emptyText: string }) {
  return (
    <ToastProvider>
      <Board {...props} />
    </ToastProvider>
  );
}

function Board({ tokens, emptyText }: { tokens: XxxRiskToken[]; emptyText: string }) {
  const t = useTranslations('xxxrisk');
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [sheet, setSheet] = useState<'filters' | 'quick' | null>(null);
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const quick = useQuickSolanaBuy(view.quickUsd);
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

  function update(next: Partial<View>) {
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
      <div className="flex flex-wrap items-center gap-2 px-2 py-2 md:px-3">
        <span className="flex items-center gap-1.5 font-body text-xs font-semibold text-ink-600">
          <span className={cn('h-1.5 w-1.5 rounded-full', paused ? 'bg-ink-400' : 'animate-pulse bg-up')} aria-hidden />
          {paused ? t('paused') : t('live', { n: shown.length })}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSheet('quick')}
            aria-label={t('quickAmount')}
            className="flex h-8 items-center gap-1 rounded-xl border border-accent/40 bg-accent/10 px-2.5 font-display text-xs font-bold tabular-nums text-accent"
          >
            <Zap className="h-3.5 w-3.5" fill="currentColor" aria-hidden />${view.quickUsd}
          </button>
          <button
            type="button"
            onClick={() => setSheet('filters')}
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
        <div className="flex w-full items-center gap-1 rounded-xl bg-white/[0.04] p-0.5 sm:order-none" role="group" aria-label={t('sort')}>
          {(['new', 'vol', 'mc'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={view.sort === s}
              onClick={() => update({ sort: s })}
              className={cn('h-7 flex-1 rounded-lg px-2.5 font-display text-xs font-bold transition-colors', view.sort === s ? 'bg-white/[0.1] text-ink-900' : 'text-ink-400 hover:text-ink-900')}
            >
              {t(s === 'new' ? 'sortNew' : s === 'vol' ? 'sortVol' : 'sortMc')}
            </button>
          ))}
        </div>
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
          className="grid grid-cols-2 gap-2 px-2 pb-3 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] md:px-3"
          onPointerEnter={(e) => e.pointerType === 'mouse' && setPaused(true)}
          onPointerLeave={() => setPaused(false)}
        >
          {shown.map((token) => (
            <XxxRiskCard
              key={token.mintAddress}
              token={token}
              ageS={ageOf(token)}
              fresh={(firstSeen.current.get(token.mintAddress) ?? 0) - openedAt.current > 1_500}
              quickUsd={view.quickUsd}
              buying={quick.busy === token.mintAddress}
              onBuy={() => void quick.buy(token.mintAddress, token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress))}
            />
          ))}
        </ul>
      )}

      <MobileDrawer open={sheet === 'filters'} onClose={() => setSheet(null)} title={t('filters')} desktop>
        <FilterSheet filters={view.filters} onChange={(filters) => update({ filters })} matching={preview} onDone={() => setSheet(null)} />
      </MobileDrawer>
      <MobileDrawer open={sheet === 'quick'} onClose={() => setSheet(null)} title={t('quickAmount')} desktop>
        <QuickAmountSheet value={view.quickUsd} onChange={(quickUsd) => update({ quickUsd })} onDone={() => setSheet(null)} />
      </MobileDrawer>
    </div>
  );
}

function XxxRiskCard({ token, ageS, fresh, quickUsd, buying, onBuy }: { token: XxxRiskToken; ageS: number; fresh: boolean; quickUsd: number; buying: boolean; onBuy: () => void }) {
  const t = useTranslations('xxxrisk');
  const curve = Math.max(0, Math.min(100, token.curvePct ?? 0));
  const change = token.priceChange5mPct ?? null;
  const buys = token.buys5m ?? null;
  const sells = token.sells5m ?? null;
  const socials = token.socials ?? {};
  const label = token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress);
  const dev = token.devPct ?? null;
  const top = token.topHoldersPct ?? null;
  const flags = token.riskFlags.filter((f) => FLAG_KEY[f]);
  const devFlagOnly = dev === null && token.riskFlags.includes('dev-holds-over-20pct');
  const topFlagOnly = top === null && token.riskFlags.includes('top-holders-over-50pct');
  const clean = token.riskFlags.length === 0;

  return (
    <li
      className={cn(
        'kamby-xcard flex flex-col overflow-hidden rounded-[20px] border border-white/[0.07] bg-surface transition-colors hover:border-white/[0.16]',
        fresh && 'kamby-card-in',
      )}
    >
      <Link href={`/solana?mint=${encodeURIComponent(token.mintAddress)}`} className="flex flex-1 flex-col gap-2.5 p-3 pb-2.5">
        <span className="flex items-start gap-2.5">
          <span
            className="relative shrink-0 rounded-full p-[2.5px]"
            style={{ background: `conic-gradient(rgb(var(--kamby-accent)) ${curve * 3.6}deg, rgba(255,255,255,0.09) 0deg)` }}
            title={t('curve', { pct: Math.round(curve) })}
          >
            <TokenAvatar src={token.imageUrl} seed={token.mintAddress} label={token.symbol ?? token.name} className="h-11 w-11 border-[2.5px] border-surface text-[0.9rem]" />
          </span>
          <span className="min-w-0 flex-1 pt-0.5">
            <span className="flex items-center gap-1">
              <span className="truncate font-display text-[0.95rem] font-extrabold leading-tight text-ink-900">{label}</span>
            </span>
            <span className="mt-0.5 block truncate font-body text-[0.7rem] leading-tight text-ink-400">{token.name ?? truncateAddress(token.mintAddress)}</span>
            <span className="mt-1 flex items-center gap-1">
              <span className={cn('rounded-md px-1.5 py-px font-mono text-[0.62rem] font-bold tabular-nums', ageS < 60 ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-ink-600')}>{ageText(ageS)}</span>
              {socials.twitter && <SocialDot kind="x" />}
              {socials.telegram && <SocialDot kind="tg" />}
              {socials.website && <SocialDot kind="web" />}
            </span>
          </span>
        </span>

        <span className="flex items-end justify-between gap-1">
          <span className="min-w-0">
            <span className="block font-body text-[0.58rem] font-semibold uppercase tracking-wide text-ink-400">{t('mc')}</span>
            <span className="block font-display text-lg font-extrabold leading-none tabular-nums text-ink-900">{money(token.marketCapUsd)}</span>
          </span>
          {change !== null && (
            <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.68rem] font-bold tabular-nums', change >= 0 ? 'bg-up/15 text-up' : 'bg-down/15 text-down')}>{formatPercent(change)}</span>
          )}
        </span>

        <span className="grid grid-cols-3 gap-1 font-mono text-[0.68rem] tabular-nums">
          <Stat label={t('vol')} value={money(token.volume5mUsd)} />
          <Stat label={t('holders')} value={token.holders != null ? String(token.holders) : '—'} />
          <Stat label={t('liq')} value={money(token.liquidityUsd)} />
        </span>

        {buys !== null && sells !== null && buys + sells > 0 && (
          <span className="flex items-center gap-1.5 font-mono text-[0.62rem] font-semibold tabular-nums" title={t('buysSells')}>
            <span className="text-up">{buys}</span>
            <span className="flex h-1 flex-1 gap-px overflow-hidden rounded-full">
              <span className="h-full rounded-full bg-up" style={{ width: `${(buys / (buys + sells)) * 100}%` }} />
              <span className="h-full flex-1 rounded-full bg-down/70" />
            </span>
            <span className="text-down">{sells}</span>
          </span>
        )}

        <span className="flex flex-wrap items-center gap-1">
          {dev !== null && <Pct label={t('dev')} value={dev} warn={10} bad={20} />}
          {top !== null && <Pct label={t('top')} value={top} warn={35} bad={50} />}
          {devFlagOnly && <Badge bad>{t('flagDev')}</Badge>}
          {topFlagOnly && <Badge bad>{t('flagTop')}</Badge>}
          {flags.map((f) => (
            <Badge key={f} bad>
              {t(FLAG_KEY[f]!)}
            </Badge>
          ))}
          {clean && <Badge>{t('flagClean')}</Badge>}
        </span>
      </Link>

      <button
        type="button"
        onClick={onBuy}
        disabled={buying}
        className="mx-3 mb-3 flex h-9 items-center justify-center gap-1.5 rounded-xl border border-accent/35 bg-accent/10 font-display text-[0.8rem] font-extrabold text-accent transition-colors hover:bg-accent hover:text-black active:scale-[0.98] disabled:opacity-60"
      >
        {buying ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" fill="currentColor" aria-hidden />}
        {buying ? t('buyingShort') : t('quickBuy', { usd: quickUsd })}
      </button>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded-xl bg-white/[0.04] px-1.5 py-1.5">
      <span className="block truncate font-body text-[0.56rem] font-semibold uppercase tracking-wide text-ink-400">{label}</span>
      <span className="mt-0.5 block truncate font-bold text-ink-900">{value}</span>
    </span>
  );
}

function Pct({ label, value, warn, bad }: { label: string; value: number; warn: number; bad: number }) {
  const tone = value > bad ? 'bg-down/15 text-down' : value > warn ? 'bg-amber-400/15 text-amber-300' : 'bg-white/[0.06] text-ink-600';
  return (
    <span className={cn('rounded-md px-1.5 py-px font-mono text-[0.6rem] font-bold tabular-nums', tone)}>
      {label} {value < 1 && value > 0 ? '<1' : Math.round(value)}%
    </span>
  );
}

function Badge({ children, bad = false }: { children: React.ReactNode; bad?: boolean }) {
  return <span className={cn('rounded-md px-1.5 py-px font-body text-[0.6rem] font-bold', bad ? 'bg-down/15 text-down' : 'bg-up/15 text-up')}>{children}</span>;
}

function SocialDot({ kind }: { kind: 'x' | 'tg' | 'web' }) {
  return (
    <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-white/[0.06] text-ink-600" aria-label={kind === 'x' ? 'X' : kind === 'tg' ? 'Telegram' : 'Website'}>
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

const chip = (on: boolean) =>
  cn('h-8 rounded-xl border px-3 font-display text-xs font-bold transition-colors', on ? 'border-accent/60 bg-accent/10 text-accent' : 'border-white/10 bg-white/[0.03] text-ink-900 hover:border-white/20');

/** A typed value next to the preset chips ("10k", "250") — shows the current value when it
 *  isn't one of the presets. */
function CustomInput({ value, presets, onValue, prefix }: { value: number | null; presets: readonly number[]; onValue: (v: number | null) => void; prefix?: string }) {
  const t = useTranslations('xxxrisk');
  const custom = value !== null && !presets.includes(value);
  const [text, setText] = useState(custom ? String(value) : '');
  useEffect(() => {
    if (!custom) setText('');
  }, [custom]);
  return (
    <label className={cn('flex h-8 w-24 items-center gap-0.5 rounded-xl border px-2 font-display text-xs font-bold', custom ? 'border-accent/60 bg-accent/10 text-accent' : 'border-white/10 bg-white/[0.03] text-ink-900')}>
      {prefix && <span className="text-ink-400">{prefix}</span>}
      <input
        inputMode="decimal"
        value={text}
        placeholder={t('custom')}
        aria-label={t('custom')}
        onChange={(e) => {
          setText(e.target.value);
          onValue(e.target.value.trim() === '' ? null : parseAmount(e.target.value));
        }}
        className="min-w-0 flex-1 bg-transparent placeholder:font-semibold placeholder:text-ink-400 focus:outline-none"
      />
    </label>
  );
}

function FilterSheet({ filters, onChange, matching, onDone }: { filters: Filters; onChange: (f: Filters) => void; matching: number; onDone: () => void }) {
  const t = useTranslations('xxxrisk');
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const row = (key: keyof typeof CHOICES, title: string, fmt: (v: number) => string, prefix?: string) => (
    <div>
      <p className="mb-1.5 font-body text-xs font-semibold text-ink-400">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {[null, ...CHOICES[key]].map((v) => (
          <button key={String(v)} type="button" aria-pressed={filters[key] === v} onClick={() => set({ [key]: v } as Partial<Filters>)} className={chip(filters[key] === v)}>
            {v === null ? t('any') : fmt(v)}
          </button>
        ))}
        <CustomInput value={filters[key]} presets={CHOICES[key]} prefix={prefix} onValue={(v) => set({ [key]: v } as Partial<Filters>)} />
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

  return (
    <div className="space-y-4">
      {row('maxAgeMin', t('maxAge'), (v) => t('underMin', { n: v }))}
      {row('mcMin', t('mcMin'), money, '$')}
      {row('mcMax', t('mcMax'), money, '$')}
      {row('liqMin', t('liqMin'), money, '$')}
      {row('volMin', t('volMin'), money, '$')}
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

function QuickAmountSheet({ value, onChange, onDone }: { value: number; onChange: (v: number) => void; onDone: () => void }) {
  const t = useTranslations('xxxrisk');
  const [text, setText] = useState(QUICK_PRESETS.includes(value) ? '' : String(value));
  const typed = text.trim() === '' ? null : parseAmount(text);
  const tooSmall = typed !== null && typed < MIN_TRADE_USD;
  return (
    <div className="space-y-4">
      <p className="font-body text-sm text-ink-400">{t('quickHint')}</p>
      <div className="grid grid-cols-4 gap-2">
        {QUICK_PRESETS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={value === v && text === ''}
            onClick={() => {
              setText('');
              onChange(v);
            }}
            className={cn(chip(value === v && text === ''), 'h-11 text-sm')}
          >
            ${v}
          </button>
        ))}
      </div>
      <label className="flex h-12 items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 font-display text-base font-bold text-ink-900 focus-within:border-accent/60">
        <span className="text-ink-400">$</span>
        <input
          inputMode="decimal"
          value={text}
          placeholder={t('custom')}
          aria-label={t('custom')}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseAmount(e.target.value);
            if (v !== null && v >= MIN_TRADE_USD) onChange(Math.round(v * 100) / 100);
          }}
          className="min-w-0 flex-1 bg-transparent tabular-nums placeholder:text-ink-400 focus:outline-none"
        />
      </label>
      {tooSmall && <p className="font-body text-xs font-semibold text-down">{t('minBuy', { min: MIN_TRADE_USD })}</p>}
      <button type="button" onClick={onDone} className="h-12 w-full rounded-2xl bg-accent font-display text-sm font-black text-black">
        {t('quickBuy', { usd: value })}
      </button>
    </div>
  );
}
