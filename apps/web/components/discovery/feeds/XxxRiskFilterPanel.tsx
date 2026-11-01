'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { XxxRiskColumn } from '@kamby/domain';
import { cn } from '@kamby/ui';
import { Check, Trash2 } from 'lucide-react';
import {
  MAX_PRESETS,
  NO_FILTERS,
  RANGE_KEYS,
  RANGE_UNIT,
  activeCount,
  loadPresets,
  savePresets,
  type ColumnFilters,
  type Filters,
  type Preset,
  type RangeKey,
  type ToggleKey,
} from './xxxrisk-filters';

/** A small mark for where a coin launched — on cards and in the filter's launchpad chips. */
export const LAUNCHPADS: Record<string, { mark: string; name: string; color: string }> = {
  'pump.fun': { mark: 'P', name: 'Pump.fun', color: '#5BE38F' },
  'letsbonk.fun': { mark: 'B', name: 'Bonk.fun', color: '#FF8A3D' },
  'raydium-launchlab': { mark: 'R', name: 'LaunchLab', color: '#8B9BFF' },
  'met-dbc': { mark: 'M', name: 'Meteora', color: '#F5A524' },
  Meteora: { mark: 'M', name: 'Meteora', color: '#F5A524' },
  'bags.fun': { mark: 'B', name: 'Bags', color: '#C084FC' },
  moonshot: { mark: 'M', name: 'Moonshot', color: '#F0ABFC' },
  memefun: { mark: 'M', name: 'memefun', color: '#38BDF8' },
  'boop.fun': { mark: 'B', name: 'Boop', color: '#60A5FA' },
  heaven: { mark: 'H', name: 'Heaven', color: '#FDE68A' },
  'jup-studio': { mark: 'J', name: 'Jup Studio', color: '#34D399' },
  believe: { mark: 'B', name: 'Believe', color: '#A3E635' },
  'time.fun': { mark: 'T', name: 'time.fun', color: '#FCA5A5' },
  'cooking.city': { mark: 'C', name: 'Cooking', color: '#FB923C' },
  dealr: { mark: 'D', name: 'Dealr', color: '#94A3B8' },
  moonit: { mark: 'M', name: 'Moonit', color: '#E879F9' },
  // BNB / Base / Robinhood (2026-11-01).
  'four.meme': { mark: '4', name: 'Four.meme', color: '#F3BA2F' },
  flap: { mark: 'F', name: 'Flap', color: '#D9F99D' },
  clanker: { mark: 'C', name: 'Clanker', color: '#A78BFA' },
  pons: { mark: 'P', name: 'Pons', color: '#CCFF00' },
  'uniswap-v4': { mark: 'U', name: 'Uniswap v4', color: '#FF66C4' },
  uniswap: { mark: 'U', name: 'Uniswap', color: '#FF66C4' },
  pancakeswap: { mark: 'C', name: 'PancakeSwap', color: '#38BDF8' },
  aerodrome: { mark: 'A', name: 'Aerodrome', color: '#60A5FA' },
};

/** The chains on the board, for the filter's chain chips. */
export const BOARD_CHAINS: { id: string; name: string }[] = [
  { id: 'solana', name: 'Solana' },
  { id: 'eip155:56', name: 'BNB' },
  { id: 'eip155:8453', name: 'Base' },
  { id: 'eip155:4663', name: 'Robinhood' },
];
export const launchpadInfo = (id: string) => LAUNCHPADS[id] ?? { mark: id.charAt(0).toUpperCase(), name: id, color: '#94A3B8' };

const COLUMN_TABS: { id: XxxRiskColumn; key: 'colNew' | 'colSoon' | 'colMigrated' }[] = [
  { id: 'new', key: 'colNew' },
  { id: 'soon', key: 'colSoon' },
  { id: 'migrated', key: 'colMigrated' },
];
const SOCIAL_TOGGLES: ToggleKey[] = ['hasX', 'hasTelegram', 'hasWebsite', 'devUnder20'];
const AUDIT_TOGGLES: ToggleKey[] = ['hideMint', 'hideFreeze', 'auditedOnly'];
const UNIT_SUFFIX = { usd: '$', pct: '%', min: 'min', count: '' } as const;

/** "10k" → 10000, "1.5m" → 1500000; plain numbers as they are. */
function parseNumber(text: string): number | null {
  const m = /^\s*\$?\s*(-?\d+(?:[.,]\d+)?)\s*([km])?\s*%?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(',', '.'));
  const mult = m[2]?.toLowerCase() === 'k' ? 1e3 : m[2]?.toLowerCase() === 'm' ? 1e6 : 1;
  return Number.isFinite(n) ? n * mult : null;
}

function show(v: number | null, unit: (typeof RANGE_UNIT)[RangeKey]): string {
  if (v === null) return '';
  if (unit === 'usd') return v >= 1e6 ? `${v / 1e6}m` : v >= 1e3 ? `${v / 1e3}k` : String(v);
  return String(v);
}

function NumberBox({ value, unit, placeholder, onValue }: { value: number | null; unit: (typeof RANGE_UNIT)[RangeKey]; placeholder: string; onValue: (v: number | null) => void }) {
  const [text, setText] = useState(show(value, unit));
  // A reset or a loaded preset rewrites the box.
  useEffect(() => {
    if (parseNumber(text) !== value) setText(show(value, unit));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only outside changes
  }, [value]);
  const suffix = UNIT_SUFFIX[unit];
  return (
    <label className={cn('flex h-9 min-w-0 items-center gap-1 rounded-xl border px-2.5 font-display text-xs font-bold', value !== null ? 'border-accent/50 bg-accent/[0.07] text-ink-900' : 'border-white/[0.08] bg-white/[0.03] text-ink-900')}>
      <input
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          onValue(e.target.value.trim() === '' ? null : parseNumber(e.target.value));
        }}
        className="min-w-0 flex-1 bg-transparent tabular-nums placeholder:font-semibold placeholder:text-ink-400 focus:outline-none"
      />
      {suffix && <span className="shrink-0 text-ink-400">{suffix}</span>}
    </label>
  );
}

function Tick({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onToggle} className="flex min-w-0 items-center gap-2 py-1.5 text-left font-body text-[0.82rem] text-ink-900">
      <span className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border', on ? 'border-accent bg-accent text-black' : 'border-white/25')}>
        {on && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The launchpad board's filter panel (2026-11-01, like GMGN's): a tab per column plus Saved;
 * each column has its own launchpads, socials and safety ticks, and min/max for every number.
 */
export function XxxRiskFilterPanel({
  value,
  onChange,
  column,
  launchpadsSeen,
  matching,
  onDone,
}: {
  value: ColumnFilters;
  onChange: (next: ColumnFilters) => void;
  column: XxxRiskColumn;
  /** Launchpads in the coins right now — known ones always show too. */
  launchpadsSeen: string[];
  matching: Record<XxxRiskColumn, number>;
  onDone: () => void;
}) {
  const t = useTranslations('xxxrisk');
  const [tab, setTab] = useState<XxxRiskColumn | 'saved'>(column);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState('');
  useEffect(() => setPresets(loadPresets()), []);

  const col: XxxRiskColumn = tab === 'saved' ? column : tab;
  const f = value[col];
  const set = (patch: Partial<Filters>) => onChange({ ...value, [col]: { ...f, ...patch } });
  const pads = [...new Set(['pump.fun', 'letsbonk.fun', 'raydium-launchlab', 'met-dbc', 'bags.fun', 'moonshot', 'four.meme', 'clanker', 'pons', ...launchpadsSeen.filter((p) => p !== 'Meteora')])];
  const chainOn = (c: string) => f.chains.length === 0 || f.chains.includes(c);
  const toggleChain = (c: string) => {
    const current = f.chains.length === 0 ? BOARD_CHAINS.map((x) => x.id) : f.chains;
    const next = current.includes(c) ? current.filter((x) => x !== c) : [...current, c];
    set({ chains: next.length === BOARD_CHAINS.length || next.length === 0 ? [] : next });
  };
  const padOn = (p: string) => f.launchpads.length === 0 || f.launchpads.includes(p);
  const togglePad = (p: string) => {
    // [] = all of them; ['none'] = "Unselect all", waiting for a pick.
    const current = f.launchpads.length === 0 ? pads : f.launchpads.filter((x) => x !== 'none');
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p];
    set({ launchpads: next.length === 0 ? ['none'] : pads.every((x) => next.includes(x)) ? [] : next });
  };

  const tabClass = (on: boolean) => cn('relative shrink-0 pb-2.5 font-display text-sm font-bold transition-colors', on ? 'text-ink-900 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent' : 'text-ink-400 hover:text-ink-600');
  const section = 'border-t border-white/[0.06] pt-4';

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 flex gap-5 overflow-x-auto border-b border-white/[0.06] px-1 [scrollbar-width:none]">
        {COLUMN_TABS.map((c) => {
          const n = activeCount(value[c.id]);
          return (
            <button key={c.id} type="button" onClick={() => setTab(c.id)} className={tabClass(tab === c.id)}>
              {t(c.key)}
              {n > 0 && <span className="ml-1 rounded-full bg-accent/15 px-1.5 font-mono text-[0.65rem] text-accent">{n}</span>}
            </button>
          );
        })}
        <span aria-hidden className="mb-2.5 w-px shrink-0 bg-white/10" />
        <button type="button" onClick={() => setTab('saved')} className={tabClass(tab === 'saved')}>
          {t('fSaved')}
        </button>
      </div>

      {tab === 'saved' ? (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fPresetName')}
              aria-label={t('fPresetName')}
              className="h-11 min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 font-body text-sm text-ink-900 placeholder:text-ink-400 focus:border-accent/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={!name.trim() || presets.length >= MAX_PRESETS}
              onClick={() => {
                const next = [{ name: name.trim(), filters: value }, ...presets.filter((p) => p.name !== name.trim())].slice(0, MAX_PRESETS);
                setPresets(next);
                savePresets(next);
                setName('');
              }}
              className="h-11 shrink-0 rounded-xl bg-accent px-4 font-display text-sm font-black text-black disabled:opacity-40"
            >
              {t('fSave')}
            </button>
          </div>
          {presets.length === 0 ? (
            <p className="py-6 text-center font-body text-sm text-ink-400">{t('fNoSaved')}</p>
          ) : (
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06]">
              {presets.map((p) => (
                <li key={p.name} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate font-display text-sm font-bold text-ink-900">{p.name}</span>
                  <span className="font-mono text-[0.65rem] text-ink-400">{activeCount(p.filters.new) + activeCount(p.filters.soon) + activeCount(p.filters.migrated)}</span>
                  <button type="button" onClick={() => onChange(p.filters)} className="h-8 rounded-lg bg-white/[0.06] px-3 font-display text-xs font-bold text-ink-900">
                    {t('fUse')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('fDelete')}
                    onClick={() => {
                      const next = presets.filter((x) => x.name !== p.name);
                      setPresets(next);
                      savePresets(next);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 hover:text-down"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <section>
            <h3 className="mb-2 font-display text-sm font-bold text-ink-900">{t('fChains')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {BOARD_CHAINS.map((c) => (
                <button key={c.id} type="button" aria-pressed={chainOn(c.id)} onClick={() => toggleChain(c.id)} className={cn('h-8 rounded-full border px-3 font-display text-xs font-bold transition-colors', chainOn(c.id) ? 'border-accent/40 bg-accent/10 text-ink-900' : 'border-white/[0.08] text-ink-400 opacity-60')}>
                  {c.name}
                </button>
              ))}
            </div>
          </section>

          <section className={section}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-ink-900">{t('fLaunchpads')}</h3>
              <button type="button" onClick={() => set({ launchpads: f.launchpads.length === 0 ? ['none'] : [] })} className="rounded-lg bg-white/[0.06] px-2.5 py-1 font-display text-[0.7rem] font-bold text-ink-900">
                {f.launchpads.length === 0 ? t('fUnselectAll') : t('fSelectAll')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pads.map((p) => {
                const info = launchpadInfo(p);
                const on = padOn(p);
                return (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePad(p)}
                    className={cn('flex h-8 items-center gap-1.5 rounded-full border px-2.5 font-display text-xs font-bold transition-colors', on ? 'text-ink-900' : 'border-white/[0.08] text-ink-400 opacity-60')}
                    style={on ? { borderColor: `${info.color}66`, backgroundColor: `${info.color}14` } : undefined}
                  >
                    <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-full text-[0.55rem] font-black text-black" style={{ backgroundColor: info.color }}>
                      {info.mark}
                    </span>
                    {info.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className={section}>
            <h3 className="mb-1 font-display text-sm font-bold text-ink-900">{t('fSocials')}</h3>
            <div className="grid grid-cols-2 gap-x-3">
              {SOCIAL_TOGGLES.map((k) => (
                <Tick key={k} on={Boolean(f.toggles[k])} label={t(`fT_${k}`)} onToggle={() => set({ toggles: { ...f.toggles, [k]: !f.toggles[k] } })} />
              ))}
            </div>
            <h3 className="mb-1 mt-3 font-display text-sm font-bold text-ink-900">{t('fAudit')}</h3>
            <div className="grid grid-cols-2 gap-x-3">
              {AUDIT_TOGGLES.map((k) => (
                <Tick key={k} on={Boolean(f.toggles[k])} label={t(`fT_${k}`)} onToggle={() => set({ toggles: { ...f.toggles, [k]: !f.toggles[k] } })} />
              ))}
            </div>
          </section>

          <section className={cn(section, 'flex flex-col gap-2')}>
            {RANGE_KEYS.filter((k) => !(col === 'migrated' && k === 'curve')).map((k) => {
              const r = f.ranges[k] ?? { min: null, max: null };
              const put = (patch: Partial<typeof r>) => set({ ranges: { ...f.ranges, [k]: { ...r, ...patch } } });
              return (
                <div key={k} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2">
                  <span className="truncate font-body text-[0.82rem] text-ink-600">{t(`fR_${k}`)}</span>
                  <NumberBox value={r.min} unit={RANGE_UNIT[k]} placeholder={t('fMin')} onValue={(min) => put({ min })} />
                  <NumberBox value={r.max} unit={RANGE_UNIT[k]} placeholder={t('fMax')} onValue={(max) => put({ max })} />
                </div>
              );
            })}
          </section>
        </>
      )}

      <div className="sticky bottom-0 -mx-1 grid grid-cols-[auto_1fr] gap-2 bg-surface px-1 pb-1 pt-2">
        <button type="button" onClick={() => onChange({ ...value, [col]: NO_FILTERS })} className="h-12 rounded-2xl bg-white/[0.06] px-5 font-display text-sm font-bold text-ink-900">
          {t('reset')}
        </button>
        <button type="button" onClick={onDone} className="h-12 rounded-2xl bg-accent font-display text-sm font-black text-black">
          {t('show', { n: matching[col] })}
        </button>
      </div>
    </div>
  );
}
