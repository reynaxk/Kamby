'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChainBadge, badgeChainFor } from '@/components/market/ChainBadge';
import { marketHref } from '@/lib/solana-links';
import { useTranslations } from 'next-intl';
import {
  MIN_TRADE_USD,
  type XxxRiskColumn,
  type XxxRiskFlag,
  type XxxRiskToken,
} from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Loader2, Zap } from 'lucide-react';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { ToastProvider } from '@/components/terminal/ToastProvider';
import { cashtag, formatCompactUsd, formatPercent, truncateAddress } from '@/lib/format';
import { useQuickSolanaBuy } from '@/lib/use-quick-solana-buy';
import { QUICK_AMOUNT_EVENT } from '@/components/trading/QuickBuy';
import { NO_COLUMN_FILTERS, activeCount, passes, readColumnFilters, type ColumnFilters } from './xxxrisk-filters';
import { XxxRiskFilterPanel, launchpadInfo } from './XxxRiskFilterPanel';

type Sort = 'new' | 'vol' | 'mc';

interface View {
  sort: Sort;
  /** One set per column (2026-11-01). */
  filters: ColumnFilters;
  quickUsd: number;
  /** The column a phone shows (desktop shows all three). */
  column: XxxRiskColumn;
}

const DEFAULT_VIEW: View = { sort: 'new', filters: NO_COLUMN_FILTERS, quickUsd: 5, column: 'new' };
const STORE_KEY = 'kamby:xxxrisk-view';
const QUICK_PRESETS = [2, 5, 10, 25];
const COLUMNS: { id: XxxRiskColumn; key: 'colNew' | 'colSoon' | 'colMigrated' }[] = [
  { id: 'new', key: 'colNew' },
  { id: 'soon', key: 'colSoon' },
  { id: 'migrated', key: 'colMigrated' },
];

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
      const v = JSON.parse(raw) as Partial<View> & { filters?: unknown };
      return {
        sort: 'new',
        filters: readColumnFilters(v.filters),
        quickUsd:
          typeof v.quickUsd === 'number' && v.quickUsd > 0 ? v.quickUsd : DEFAULT_VIEW.quickUsd,
        column: COLUMNS.some((c) => c.id === v.column) ? v.column! : 'new',
      };
    }
  } catch {
    // a fresh view
  }
  return DEFAULT_VIEW;
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
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Each column's own order ("New" in the sort control), unless volume / market cap is picked. */
function order(
  list: XxxRiskToken[],
  column: XxxRiskColumn,
  sort: Sort,
  launchedAt: Map<string, number>,
): XxxRiskToken[] {
  if (sort === 'vol') return list.sort((a, b) => (b.volume5mUsd ?? 0) - (a.volume5mUsd ?? 0));
  if (sort === 'mc') return list.sort((a, b) => b.marketCapUsd - a.marketCapUsd);
  if (column === 'soon') return list.sort((a, b) => (b.curvePct ?? 0) - (a.curvePct ?? 0));
  if (column === 'migrated')
    return list.sort((a, b) => (b.graduatedAtMs ?? 0) - (a.graduatedAtMs ?? 0));
  return list.sort(
    (a, b) => (launchedAt.get(b.mintAddress) ?? 0) - (launchedAt.get(a.mintAddress) ?? 0),
  );
}

/**
 * XXXRisk as GMGN-style live columns (owner 2026-10-28: "like GMGN — appearing fast", then
 * "huge variety … really popping out"): New launches, Almost bonded and Migrated, from every
 * Solana launchpad. Desktop shows the three side by side, each scrolling on its own; a phone
 * switches between them. A coin that just arrived drops in with a brief accent edge; hovering
 * (mouse only) pauses the board so a card doesn't move under the pointer. Every card has ⚡
 * quick buy for the amount set in the bar. Sort, filters, column and amount are remembered.
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
  const [sheet, setSheet] = useState<'quick' | null>(null);
  // Which column's filters are open (2026-11-02: one filter per column).
  const [filterCol, setFilterCol] = useState<XxxRiskColumn | null>(null);
  const [search, setSearch] = useState<Record<XxxRiskColumn, string>>({ new: '', soon: '', migrated: '' });
  const [paused, setPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const quick = useQuickSolanaBuy(view.quickUsd);
  const router = useRouter();
  const frozen = useRef<XxxRiskToken[] | null>(null);
  // When each coin launched (ms), and when this screen first saw it — new arrivals animate,
  // the first load doesn't.
  const launchedAt = useRef(new Map<string, number>());
  const firstSeen = useRef(new Map<string, number>());
  const openedAt = useRef(Date.now());
  // Three columns side by side need real room (the desktop home column is ~640px) — measured,
  // not a breakpoint, so the board fits wherever it's placed.
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const wide = width >= 960;

  useEffect(() => setView(loadView()), []);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  function update(next: Partial<View>) {
    setView((v) => {
      const merged = { ...v, ...next };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(merged));
        window.dispatchEvent(new Event(QUICK_AMOUNT_EVENT)); // every other ⚡ in the app follows
      } catch {
        // remembered for this visit only
      }
      return merged;
    });
  }

  if (!paused) frozen.current = null;
  else if (!frozen.current) frozen.current = tokens;
  // A live update can arrive without an address (2026-11-03: it crashed the whole Hunt page) — skip it.
  const source = (paused && frozen.current ? frozen.current : tokens).filter((x) => typeof x.mintAddress === 'string' && x.mintAddress.length > 0);

  for (const token of source) {
    if (!launchedAt.current.has(token.mintAddress))
      launchedAt.current.set(
        token.mintAddress,
        token.createdAtMs ?? Date.now() - token.ageSeconds * 1000,
      );
    if (!firstSeen.current.has(token.mintAddress))
      firstSeen.current.set(token.mintAddress, Date.now());
  }
  const ageOf = (token: XxxRiskToken) =>
    Math.max(0, Math.round((now - (launchedAt.current.get(token.mintAddress) ?? now)) / 1000));

  const byColumn = useMemo(() => {
    const out: Record<XxxRiskColumn, XxxRiskToken[]> = { new: [], soon: [], migrated: [] };
    for (const token of source) {
      const col = token.column ?? 'new';
      const q = search[col].trim().toLowerCase();
      if (q && !`${token.symbol ?? ''} ${token.name ?? ''} ${token.mintAddress}`.toLowerCase().includes(q)) continue;
      if (passes(token, view.filters[col], ageOf(token))) out[col].push(token);
    }
    for (const c of COLUMNS) order(out[c.id], c.id, view.sort, launchedAt.current);
    return out;
  }, [source, view.filters, view.sort, now, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = activeCount(view.filters.new) + activeCount(view.filters.soon) + activeCount(view.filters.migrated);
  const launchpadsSeen = [...new Set(source.map((x) => x.launchpad ?? 'pump.fun'))];

  const card = (token: XxxRiskToken) => (
    <XxxRiskCard
      key={token.mintAddress}
      token={token}
      ageS={ageOf(token)}
      fresh={(firstSeen.current.get(token.mintAddress) ?? 0) - openedAt.current > 1_500}
      quickUsd={view.quickUsd}
      buying={quick.busy === token.mintAddress}
      onBuy={() => {
        const chain = token.chainIdentifier ?? 'solana';
        if (chain === 'solana') {
          void quick.buy(token.mintAddress, token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress));
          return;
        }
        // A BNB/Base/Robinhood coin (2026-11-01): its buy keypad, prefilled — like every EVM ⚡.
        const href = marketHref(chain, token.mintAddress);
        if (!href) return;
        try {
          window.sessionStorage.setItem('kamby:quick-prefill', JSON.stringify({ address: token.mintAddress, usd: view.quickUsd, at: Date.now() }));
        } catch {
          // the keypad just starts empty
        }
        router.push(href + (href.includes('?') ? '&' : '?') + 'buy=1');
      }}
    />
  );
  const empty = (
    <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
      <p className="font-body text-sm text-ink-400">{t('noMatch')}</p>
      {count > 0 && (
        <button
          type="button"
          onClick={() => update({ filters: NO_COLUMN_FILTERS })}
          className="h-9 rounded-xl bg-white/[0.06] px-4 font-display text-xs font-bold text-ink-900"
        >
          {t('reset')}
        </button>
      )}
    </div>
  );
  const hover = {
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && setPaused(true),
    onPointerLeave: () => setPaused(false),
  };

  return (
    <div ref={root} className="relative col-span-full">
      {/* "Paused" floats over the corner — it used to be a line of its own that pushed the whole
          board down every time the mouse came in (2026-11-03, owner's BUG video). */}
      {paused && (
        <span className="pointer-events-none absolute -top-6 right-4 z-10 flex items-center gap-1.5 font-body text-xs font-semibold text-ink-600">
          <span className="h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden />
          {t('paused')}
        </span>
      )}
      <div className={cn('flex-wrap items-center gap-2 px-2 py-2 md:px-3', wide ? 'hidden' : 'flex')}>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSheet('quick')}
            aria-label={t('quickAmount')}
            className={cn("h-8 items-center gap-1 rounded-xl border border-accent/40 bg-accent/10 px-2.5 font-display text-xs font-bold tabular-nums text-accent", wide ? "hidden" : "flex")}
          >
            <Zap className="h-3.5 w-3.5" fill="currentColor" aria-hidden />${view.quickUsd}
          </button>
          <button
            type="button"
            onClick={() => setFilterCol(view.column)}
            className={cn(
              'h-8 items-center gap-1.5 rounded-xl border px-2.5 font-display text-xs font-bold transition-colors',
              wide ? 'hidden' : 'flex',
              activeCount(view.filters[view.column]) > 0
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-white/10 bg-white/[0.04] text-ink-900 hover:border-white/20',
            )}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {t('filters')}
            {activeCount(view.filters[view.column]) > 0 && (
              <span className="rounded-md bg-accent px-1 text-[0.65rem] text-black">{activeCount(view.filters[view.column])}</span>
            )}
          </button>
        </div>
        {/* Not enough room for three: one column at a time. */}
        <div
          className={cn(
            'w-full grid-cols-3 gap-1 rounded-2xl bg-white/[0.04] p-1',
            wide ? 'hidden' : 'grid',
          )}
          role="tablist"
          aria-label={t('columns')}
        >
          {COLUMNS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={view.column === c.id}
              onClick={() => update({ column: c.id })}
              className={cn(
                'flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-xl px-2 font-display text-[0.8rem] font-extrabold transition-colors',
                view.column === c.id ? 'bg-white/[0.1] text-ink-900' : 'text-ink-400',
              )}
            >
              {/* One line, no counts (2026-11-02 polish: 'Almost bonded 100' wrapped onto two lines). */}
              <span className="truncate">{t(c.key)}</span>
            </button>
          ))}
        </div>
      </div>

      {tokens.length === 0 ? (
        <p className="p-3 font-body text-xs text-ink-400">{emptyText}</p>
      ) : (
        <>
          {!wide ? (
            <div {...hover}>
              {byColumn[view.column].length === 0 ? (
                empty
              ) : (
                <ul className={cn('mx-2 mb-3 overflow-hidden rounded-xl border border-white/[0.07] bg-[#08090C] md:mx-3', width >= 720 && 'grid grid-cols-2')}>
                  {byColumn[view.column].map(card)}
                </ul>
              )}
            </div>
          ) : (
            <div className="mx-3 mb-3 grid grid-cols-3 gap-3" {...hover}>
              {COLUMNS.map((c) => (
                <section
                  key={c.id}
                  className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-[#0A0B0E]"
                >
                  <span aria-hidden className="absolute inset-x-0 top-0 h-0.5" style={{ background: COLUMN_TONE[c.id] }} />
                  <header className="flex flex-wrap items-center gap-2 border-b border-line bg-gradient-to-b from-white/[0.025] to-transparent px-3 pb-2.5 pt-3">
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        c.id === 'new'
                          ? 'bg-accent'
                          : c.id === 'soon'
                            ? 'bg-amber-300'
                            : 'bg-[#6BB6FF]',
                      )}
                      aria-hidden
                    />
                    <h3 className="text-[0.86rem] font-semibold text-ink-900">{t(c.key)}</h3>
                    <span className="rounded-md bg-white/[0.05] px-1.5 font-mono text-[0.68rem] tabular-nums text-ink-400">
                      {byColumn[c.id].length}
                    </span>
                    <span className="basis-full" aria-hidden />
                    {/* Each column's own search and quick amount (2026-11-02, Axiom Pulse-style). */}
                    <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-white/[0.08] bg-black/30 px-2 text-ink-400 focus-within:border-white/20">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                      </svg>
                      <input
                        value={search[c.id]}
                        onChange={(e) => setSearch((cur) => ({ ...cur, [c.id]: e.target.value }))}
                        placeholder={t('searchColumn')}
                        aria-label={t('searchColumn')}
                        className="min-w-0 flex-1 bg-transparent font-body text-[0.72rem] text-ink-900 placeholder:text-ink-400 focus:outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setSheet('quick')}
                      aria-label={t('quickAmount')}
                      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-accent/25 bg-accent/[0.08] px-2 font-mono text-[0.7rem] font-semibold tabular-nums text-accent hover:border-accent/50"
                    >
                      <Zap className="h-2.5 w-2.5" fill="currentColor" aria-hidden />
                      {view.quickUsd}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFilterCol(c.id)}
                      className={cn(
                        'flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 font-display text-[0.7rem] font-bold transition-colors',
                        activeCount(view.filters[c.id]) > 0
                          ? 'border-accent/50 bg-accent/10 text-accent'
                          : 'border-white/10 text-ink-600 hover:border-white/20 hover:text-ink-900',
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                        <path d="M4 6h16M7 12h10M10 18h4" />
                      </svg>
                      <span className="sr-only">{t('filters')}</span>
                      {activeCount(view.filters[c.id]) > 0 && (
                        <span className="rounded bg-accent px-1 text-[0.6rem] text-black">{activeCount(view.filters[c.id])}</span>
                      )}
                    </button>
                  </header>
                  <div className="kamby-thin-scroll max-h-[calc(100dvh-13rem)] min-h-[24rem] overflow-y-auto [overflow-anchor:none]">
                    {byColumn[c.id].length === 0 ? (
                      empty
                    ) : (
                      <ul>{byColumn[c.id].map(card)}</ul>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <MobileDrawer
        open={filterCol !== null}
        onClose={() => setFilterCol(null)}
        title={filterCol ? `${t('filters')} · ${t(COLUMNS.find((c) => c.id === filterCol)!.key)}` : t('filters')}
        desktop
      >
        {filterCol && (
          <XxxRiskFilterPanel
            key={filterCol}
            single
            value={view.filters}
            onChange={(filters) => update({ filters })}
            column={filterCol}
            launchpadsSeen={launchpadsSeen}
            matching={{ new: byColumn.new.length, soon: byColumn.soon.length, migrated: byColumn.migrated.length }}
            onDone={() => setFilterCol(null)}
          />
        )}
      </MobileDrawer>
      <MobileDrawer
        open={sheet === 'quick'}
        onClose={() => setSheet(null)}
        title={t('quickAmount')}
        desktop
      >
        <QuickAmountSheet
          value={view.quickUsd}
          onChange={(quickUsd) => update({ quickUsd })}
          onDone={() => setSheet(null)}
        />
      </MobileDrawer>
    </div>
  );
}

function XxxRiskCard({
  token,
  ageS,
  fresh,
  quickUsd,
  buying,
  onBuy,
}: {
  token: XxxRiskToken;
  ageS: number;
  fresh: boolean;
  quickUsd: number;
  buying: boolean;
  onBuy: () => void;
}) {
  const t = useTranslations('xxxrisk');
  const curve = Math.max(0, Math.min(100, token.curvePct ?? 0));
  const change =
    token.priceChange5mPct != null && Math.abs(token.priceChange5mPct) >= 0.01
      ? token.priceChange5mPct
      : null;
  const buys = token.buys5m ?? null;
  const sells = token.sells5m ?? null;
  const socials = token.socials ?? {};
  const label = token.symbol ? cashtag(token.symbol) : truncateAddress(token.mintAddress);
  const dev = token.devPct ?? null;
  const top = token.topHoldersPct ?? null;
  const flags = token.riskFlags.filter((f) => FLAG_KEY[f]);
  const devFlagOnly = dev === null && token.riskFlags.includes('dev-holds-over-20pct');
  const topFlagOnly = top === null && token.riskFlags.includes('top-holders-over-50pct');
  // "Clean" only when no flag tripped AND no holder share is in the red.
  const clean =
    token.riskFlags.length === 0 &&
    !((top ?? 0) > 50 || (dev ?? 0) > 20 || [token.snipersPct, token.insidersPct, token.bundlersPct].some((v) => (v ?? 0) > 30));
  const pad = token.launchpad ? launchpadInfo(token.launchpad) : undefined;
  const evmChain = token.chainIdentifier && token.chainIdentifier !== 'solana' ? token.chainIdentifier : null;
  const badge = evmChain ? badgeChainFor(evmChain) : null;
  const migrated = token.column === 'migrated';
  const age =
    migrated && token.graduatedAtMs
      ? Math.max(0, Math.round((Date.now() - token.graduatedAtMs) / 1000))
      : ageS;

  // Safety chips on one line, most important first (2026-11-04 redesign: rows wrapped to 2–3
  // lines of chips and every row came out a different height).
  const chips: React.ReactNode[] = [
    ...(devFlagOnly ? [<Badge key="fd" bad>{t('flagDev')}</Badge>] : []),
    ...(topFlagOnly ? [<Badge key="ft" bad>{t('flagTop')}</Badge>] : []),
    ...flags.map((f) => <Badge key={f} bad>{t(FLAG_KEY[f]!)}</Badge>),
    ...(top !== null ? [<Pct key="top" label={t('top')} value={top} warn={35} bad={50} />] : []),
    ...(dev !== null ? [<Pct key="dev" label={t('dev')} value={dev} warn={10} bad={20} />] : []),
    ...(token.snipersPct != null ? [<Pct key="sn" label={t('snipers')} value={token.snipersPct} warn={10} bad={30} />] : []),
    ...(token.insidersPct != null ? [<Pct key="in" label={t('insiders')} value={token.insidersPct} warn={10} bad={30} />] : []),
    ...(token.bundlersPct != null ? [<Pct key="bu" label={t('bundlers')} value={token.bundlersPct} warn={10} bad={30} />] : []),
  ];
  const flow = buys !== null && sells !== null && buys + sells > 0 ? Math.round((buys / (buys + sells)) * 100) : null;
  const ring = migrated ? '#6BB6FF' : curve >= 85 ? '#F5C451' : 'rgb(var(--kamby-accent))';

  return (
    <li
      className={cn(
        'kamby-xcard group relative border-b border-white/[0.04] transition-colors hover:bg-white/[0.025]',
        fresh && 'kamby-card-in',
      )}
    >
      <Link
        href={evmChain ? (marketHref(evmChain, token.mintAddress) ?? '#') : `/solana?mint=${encodeURIComponent(token.mintAddress)}`}
        className="grid h-[78px] grid-cols-[46px_minmax(0,1fr)_96px] items-center gap-x-2.5 px-3"
      >
        <span
          className="relative h-[46px] w-[46px] rounded-xl p-[2px]"
          style={{ background: `conic-gradient(${ring} ${curve * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
          title={t('curve', { pct: Math.round(curve) })}
        >
          <TokenAvatar
            src={token.imageUrl}
            seed={token.mintAddress}
            label={token.symbol ?? token.name}
            className="!rounded-[10px] h-[42px] w-[42px] border-2 border-[#0A0B0E] text-base"
          />
          {pad && (
            <span
              className="absolute -bottom-1 -right-1 flex h-[17px] w-[17px] items-center justify-center rounded-md border-2 border-[#0A0B0E] bg-black text-[0.55rem] font-black"
              style={{ color: pad.color }}
              title={pad.name}
            >
              {pad.mark}
            </span>
          )}
          {badge && <ChainBadge chain={badge} className="!-bottom-1 !-left-1 !right-auto h-[17px] w-[17px] ring-[2.5px]" />}
        </span>

        <span className="flex min-w-0 flex-col gap-[5px]">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 truncate text-[0.86rem] font-semibold leading-tight text-ink-900">{label}</span>
            <span className="min-w-0 truncate text-[0.72rem] text-ink-400">{token.name}</span>
            <span className={cn('shrink-0 font-mono text-[0.68rem] font-semibold tabular-nums', ageS < 60 && !migrated ? 'text-accent' : 'text-up')}>
              {ageText(age)}
            </span>
            <span className="ml-auto flex shrink-0 gap-[3px] opacity-80">
              {socials.twitter && <SocialDot kind="x" />}
              {socials.telegram && <SocialDot kind="tg" />}
              {socials.website && <SocialDot kind="web" />}
            </span>
          </span>
          <span className="grid grid-cols-[auto_auto_auto_minmax(0,1fr)] items-center gap-2.5 font-mono text-[0.68rem] tabular-nums text-ink-600">
            <span className="flex items-center gap-0.5" title={t('holders')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" />
              </svg>
              {token.holders ?? '—'}
            </span>
            <span title={t('buysSells')}>
              {buys !== null && sells !== null ? (
                <>
                  <span className="text-up">{buys}</span>
                  <span className="text-ink-400">/</span>
                  <span className="text-down">{sells}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <span className={cn(change === null ? 'text-ink-400' : change >= 0 ? 'text-up' : 'text-down')}>
              {change === null ? '—' : formatPercent(change)}
            </span>
            {flow !== null ? (
              <span className="block h-1 overflow-hidden rounded-full bg-down/70" title={`${flow}% buys`}>
                <span className="block h-full rounded-full bg-up" style={{ width: `${flow}%` }} />
              </span>
            ) : (
              <span />
            )}
          </span>
          {/* Chips that don't fit wrap onto a hidden second line, so none is cut mid-word. */}
          <span className="flex h-[17px] min-w-0 flex-wrap items-center gap-1 overflow-hidden">
            {chips.length > 0 ? chips.slice(0, 3) : clean && <Badge>{t('flagClean')}</Badge>}
            {chips.length > 0 && chips.length <= 3 && clean && <Badge>{t('flagClean')}</Badge>}
            {token.liquidityUsd != null && <span className="shrink-0 whitespace-nowrap rounded-[5px] border border-white/[0.07] px-1.5 py-px font-mono text-[0.6rem] text-ink-400">L {money(token.liquidityUsd)}</span>}
          </span>
        </span>

        <span className="flex h-full flex-col items-end justify-start gap-1 pt-3 text-right">
          <span className={cn('whitespace-nowrap font-mono text-[0.88rem] font-semibold leading-none tabular-nums', mcTone(token.marketCapUsd))}>
            <span className="mr-0.5 font-body text-[0.56rem] font-semibold tracking-wide text-ink-400">{t('mc')}</span>
            {money(token.marketCapUsd)}
          </span>
          <span className="whitespace-nowrap font-mono text-[0.62rem] tabular-nums text-ink-400">
            {t('v')} {money(token.volume5mUsd)}
          </span>
        </span>
      </Link>

      {/* The address only on hover — it took a whole line under every icon. */}
      <span className="pointer-events-none absolute bottom-[3px] left-3 font-mono text-[0.56rem] text-ink-400 opacity-0 transition-opacity group-hover:opacity-100">
        {`${token.mintAddress.slice(0, 4)}…${token.mintAddress.slice(-4)}`}
      </span>

      <button
        type="button"
        onClick={onBuy}
        disabled={buying}
        aria-label={t('quickBuy', { usd: quickUsd })}
        className="absolute bottom-2.5 right-3 flex h-[26px] items-center gap-1 rounded-lg bg-accent px-2.5 font-mono text-[0.72rem] font-semibold tabular-nums text-accent-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.18)] transition hover:brightness-110 active:scale-[0.96] disabled:opacity-60"
      >
        {buying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Zap className="h-3 w-3" fill="currentColor" aria-hidden />}
        {buying ? t('buyingShort') : `$${quickUsd}`}
      </button>
    </li>
  );
}

/** Each column's colour: its top edge and the dot by its name. */
const COLUMN_TONE: Record<string, string> = { new: 'rgb(var(--kamby-accent))', soon: '#F5C451', migrated: '#6BB6FF' };

/** Bigger coins read warmer at a glance: $100K+ gold, $30K+ blue. */
function mcTone(mc: number | null | undefined): string {
  if (mc == null) return 'text-ink-900';
  return mc >= 100_000 ? 'text-[#F6CF86]' : mc >= 30_000 ? 'text-[#8CCBF6]' : 'text-ink-900';
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="min-w-0 rounded-xl bg-white/[0.04] px-1.5 py-1.5">
      <span className="block truncate font-body text-[0.56rem] font-semibold uppercase tracking-wide text-ink-400">
        {label}
      </span>
      <span className="mt-0.5 block truncate font-bold text-ink-900">{value}</span>
    </span>
  );
}

function Pct({
  label,
  value,
  warn,
  bad,
}: {
  label: string;
  value: number;
  warn: number;
  bad: number;
}) {
  const tone =
    value > bad
      ? 'border-down/30 bg-down/[0.07] text-down'
      : value > warn
        ? 'border-amber-400/30 bg-amber-400/[0.06] text-amber-300'
        : value > 0
          ? 'border-white/[0.07] bg-white/[0.02] text-ink-600'
          : 'border-up/25 bg-up/[0.06] text-up';
  return (
    <span
      className={cn('shrink-0 whitespace-nowrap rounded-[5px] border px-1.5 py-px font-mono text-[0.6rem] font-medium tabular-nums', tone)}
    >
      {label} {value < 1 && value > 0 ? '<1' : Math.round(value)}%
    </span>
  );
}

function Badge({ children, bad = false }: { children: React.ReactNode; bad?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap rounded-[5px] border px-1.5 py-px font-mono text-[0.6rem] font-medium',
        bad ? 'border-down/30 bg-down/[0.07] text-down' : 'border-up/25 bg-up/[0.06] text-up',
      )}
    >
      {children}
    </span>
  );
}

function SocialDot({ kind }: { kind: 'x' | 'tg' | 'web' }) {
  return (
    <span
      className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-white/[0.06] text-ink-600"
      aria-label={kind === 'x' ? 'X' : kind === 'tg' ? 'Telegram' : 'Website'}
    >
      {kind === 'x' ? (
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.2 2H21l-6.5 7.4L22 22h-6l-4.7-6.1L5.8 22H3l7-8L2 2h6.1l4.2 5.6L18.2 2Z" />
        </svg>
      ) : kind === 'tg' ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M21.5 3.5 2.8 10.7c-1 .4-1 1.6.1 1.9l4.7 1.5 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.8 3.5c.7.5 1.6.1 1.8-.7l3-15c.2-1.1-.9-2-2-1.4ZM9.6 14.3l-.4 3.6-1.3-4 9.6-6.3-7.9 6.7Z" />
        </svg>
      ) : (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
      )}
    </span>
  );
}

const chip = (on: boolean) =>
  cn(
    'h-8 rounded-xl border px-3 font-display text-xs font-bold transition-colors',
    on
      ? 'border-accent/60 bg-accent/10 text-accent'
      : 'border-white/10 bg-white/[0.03] text-ink-900 hover:border-white/20',
  );

/** A typed value next to the preset chips ("10k", "250") — shows the current value when it
 *  isn't one of the presets. */
function QuickAmountSheet({
  value,
  onChange,
  onDone,
}: {
  value: number;
  onChange: (v: number) => void;
  onDone: () => void;
}) {
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
      {tooSmall && (
        <p className="font-body text-xs font-semibold text-down">
          {t('minBuy', { min: MIN_TRADE_USD })}
        </p>
      )}
      <button
        type="button"
        onClick={onDone}
        className="h-12 w-full rounded-2xl bg-accent font-display text-sm font-black text-black"
      >
        {t('quickUse', { usd: value })}
      </button>
    </div>
  );
}
