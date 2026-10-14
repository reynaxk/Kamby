'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatPrice } from '@/lib/format';
import { fetchMyReferralSummary } from '@/lib/referrals-client';
import { fetchMyProfileShared } from '@/lib/profile-client';

export interface PnlShare {
  symbol: string | null;
  logoUrl: string | null;
  seed: string;
  pnlUsd: number;
  pnlPct: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
  /** What was paid and what it's worth now, in USD — shown when known. */
  investedUsd?: number | null;
  valueUsd?: number | null;
  /** 'Solana', 'Base', 'BNB Chain', 'Robinhood Chain' — a small tag on the card. */
  chainName?: string | null;
  /** A closed (sold) part: "Sold for" and "Exit" instead of "Worth now" and "Now". */
  sold?: boolean;
}

type ThemeId = 'neon' | 'midnight' | 'paper';

interface CardTheme {
  background: string;
  text: string;
  muted: string;
  panel: string;
  up: string;
  down: string;
  /** The big K behind the numbers, faded as one shape. */
  mark: string;
  markOpacity: number;
  /** The colour the card ends on — the controls under it sit on this, so it reads as one card. */
  base: string;
  swatch: string;
}

const THEMES: Record<ThemeId, CardTheme> = {
  neon: {
    background: '#05070A',
    text: '#FFFFFF',
    muted: 'rgba(255,255,255,0.5)',
    panel: 'rgba(255,255,255,0.06)',
    up: '#00FF87',
    down: '#FF3B69',
    mark: '#00FF87',
    base: '#05070A',
    markOpacity: 0.08,
    swatch: 'linear-gradient(135deg,#05070A 55%,#00FF87)',
  },
  midnight: {
    background: 'linear-gradient(165deg,#141B4D 0%,#0A0E26 45%,#05070A 100%)',
    text: '#FFFFFF',
    muted: 'rgba(255,255,255,0.55)',
    panel: 'rgba(255,255,255,0.07)',
    up: '#00FF87',
    down: '#FF5C82',
    mark: '#FFFFFF',
    base: '#05070A',
    markOpacity: 0.05,
    swatch: 'linear-gradient(135deg,#141B4D,#05070A)',
  },
  paper: {
    background: '#F3F4EE',
    text: '#05070A',
    muted: 'rgba(5,7,10,0.5)',
    panel: 'rgba(5,7,10,0.05)',
    up: '#00A85A',
    down: '#E0244F',
    mark: '#05070A',
    base: '#F3F4EE',
    markOpacity: 0.05,
    swatch: 'linear-gradient(135deg,#F3F4EE 55%,#00A85A)',
  },
};
const THEME_KEY = 'kamby:pnl-theme';
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * A shareable PnL card (2026-10-09, reworked 2026-10-14 after GMGN's share cards): the coin, the
 * profit in % and $, invested vs worth now, entry vs now, the trader's name and a QR code of their
 * referral link — drawn in the browser at 1080×1350 (4:5, the X/Instagram/TikTok feed size) and
 * shared as a PNG (phone share sheet) or downloaded. Three looks to pick from. Every shared win is
 * an invite with the sharer's code.
 */
export function PnlShareButton({ share, className, variant = 'icon' }: { share: PnlShare; className?: string; variant?: 'icon' | 'cta' }) {
  const t = useTranslations('share');
  const [open, setOpen] = useState(false);
  if (variant === 'cta') {
    // Right after a winning sell (2026-10-14): the big way in.
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn('flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3 font-display text-sm font-bold text-black', className)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8h16v-8" />
            <path d="M12 3v13" />
            <path d="m7 8 5-5 5 5" />
          </svg>
          {t('shareWin')}
        </button>
        {open && <PnlShareSheet share={share} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('sharePnl')}
        title={t('sharePnl')}
        className={cn('flex h-7 w-7 items-center justify-center rounded-full text-ink-400 transition-colors hover:bg-surface-raised hover:text-ink-900', className)}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 12v8h16v-8" />
          <path d="M12 3v13" />
          <path d="m7 8 5-5 5 5" />
        </svg>
      </button>
      {open && <PnlShareSheet share={share} onClose={() => setOpen(false)} />}
    </>
  );
}

function useStoredTheme(): [ThemeId, (id: ThemeId) => void] {
  const [theme, setTheme] = useState<ThemeId>('neon');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY);
      if (saved && saved in THEMES) setTheme(saved as ThemeId);
    } catch {
      // storage unavailable — neon stays
    }
  }, []);
  const choose = (id: ThemeId) => {
    setTheme(id);
    try {
      window.localStorage.setItem(THEME_KEY, id);
    } catch {
      // applied, just not remembered
    }
  };
  return [theme, choose];
}

function money(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `$${(abs / 1_000).toFixed(1)}K`;
  return `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PnlShareSheet({ share, onClose }: { share: PnlShare; onClose: () => void }) {
  const t = useTranslations('share');
  const tU = useTranslations('ui');
  const cardRef = useRef<HTMLDivElement>(null);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [themeId, setThemeId] = useStoredTheme();
  const theme = THEMES[themeId];

  useEffect(() => {
    fetchMyReferralSummary()
      .then((s) => setRefCode(s.referralCode))
      .catch(() => setRefCode(null));
    fetchMyProfileShared()
      .then((p) => setUsername(p.username))
      .catch(() => setUsername(null));
  }, []);

  const link = `kambesh.com${refCode ? `/?ref=${refCode}` : ''}`;
  useEffect(() => {
    let live = true;
    import('qrcode')
      // A CommonJS library: bundlers hand it over as the module or under `default`.
      .then((mod) => ((mod as unknown as { default?: typeof mod }).default ?? mod).toDataURL(`https://${link}`, { margin: 0, width: 192, color: { dark: '#05070A', light: '#FFFFFF' } }))
      .then((url) => live && setQr(url))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [link]);

  const up = share.pnlUsd >= 0;
  const tone = up ? theme.up : theme.down;
  const pct = share.pnlPct === null ? null : `${share.pnlPct >= 0 ? '+' : ''}${share.pnlPct.toFixed(Math.abs(share.pnlPct) >= 100 ? 0 : 1)}%`;
  const usd = `${share.pnlUsd >= 0 ? '+' : '-'}${money(share.pnlUsd)}`;
  const ticker = `$${(share.symbol ?? 'TOKEN').replace(/^\$+/, '')}`;
  const hasAmounts = share.investedUsd != null && share.valueUsd != null;

  async function render(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    const { toBlob } = await import('html-to-image');
    // 360×450 css px × 3 = 1080×1350. A coin logo that refuses cross-origin reads is left blank
    // instead of failing the whole picture.
    return toBlob(cardRef.current, { pixelRatio: 3, cacheBust: true, imagePlaceholder: TRANSPARENT_PIXEL }).catch(() => null);
  }

  async function shareImage() {
    setBusy(true);
    try {
      const blob = await render();
      const file = blob ? new File([blob], `kamby-${ticker.slice(1)}-pnl.png`, { type: 'image/png' }) : null;
      const text = t('shareText', { ticker, pct: pct ?? usd, link: `https://${link}` });
      if (file && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text });
      else if (navigator.share) await navigator.share({ text, url: `https://${link}` });
      else if (blob) download(blob);
    } catch {
      // the share sheet was dismissed
    } finally {
      setBusy(false);
    }
  }

  async function saveImage() {
    setBusy(true);
    try {
      const blob = await render();
      if (blob) download(blob);
    } finally {
      setBusy(false);
    }
  }

  function download(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kamby-${ticker.slice(1)}-pnl.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const card: CSSProperties = { background: theme.background, color: theme.text, width: 360, height: 450 };

  // Only the card (owner 2026-10-14: "remove that layer, leave only the black card, put share
  // and save inside it"): no sheet around it, the controls in the card's own bottom strip — and
  // only the top 360×450 part (cardRef) is drawn into the picture.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      {/* Scaled down on narrow phones so it all fits; the picture is still 1080×1350. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('sharePnl')}
        onClick={(e) => e.stopPropagation()}
        className="kamby-sheet-up overflow-hidden rounded-[28px] shadow-[0_24px_80px_rgba(0,0,0,0.6)] max-[400px]:scale-[0.9]"
        style={{ background: theme.base, color: theme.text }}
      >
        <div ref={cardRef} className="relative overflow-hidden rounded-[28px] p-6" style={card}>
          {/* The neon K, big and faint behind everything. */}
          <svg className="pointer-events-none absolute -right-16 -top-6" width="330" height="330" viewBox="0 0 512 512" aria-hidden="true">
            <g fill="none" stroke={theme.mark} strokeWidth="92" strokeLinecap="round" opacity={theme.markOpacity}>
              <path d="M186 140 V372" />
              <path d="M200 268 L338 140" />
              <path d="M232 246 L346 372" />
            </g>
          </svg>

          <div className="relative flex items-center justify-between">
            <span className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/kamby-mark.svg" alt="" width={28} height={28} className="h-7 w-7 rounded-lg" />
              <span className="font-display text-lg font-black tracking-tight">KAMBY</span>
            </span>
            {share.chainName && (
              <span className="rounded-full px-2.5 py-1 font-body text-[0.6rem] font-semibold uppercase tracking-wider" style={{ background: theme.panel, color: theme.muted }}>
                {share.chainName}
              </span>
            )}
          </div>

          <div className="relative mt-7 flex items-center gap-3">
            <TokenAvatar src={share.logoUrl} seed={share.seed} label={share.symbol} className="h-12 w-12 text-base" />
            <span className="min-w-0">
              <span className="block truncate font-display text-2xl font-bold leading-tight">{ticker}</span>
              {username && (
                <span className="block truncate font-body text-xs" style={{ color: theme.muted }}>
                  @{username}
                </span>
              )}
            </span>
          </div>

          <p className="relative mt-4 font-display text-[4rem] font-black leading-none tracking-tight" style={{ color: tone }}>
            {pct ?? usd}
          </p>
          {pct && (
            <p className="relative mt-2 font-body tabular-nums text-xl font-bold" style={{ color: tone }}>
              {usd}
            </p>
          )}

          <div className="absolute inset-x-6 bottom-6">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 font-body tabular-nums text-[0.7rem]">
              {hasAmounts ? (
                <>
                  <Stat label={t('invested')} value={money(share.investedUsd as number)} theme={theme} />
                  <Stat label={t(share.sold ? 'soldFor' : 'worthNow')} value={money(share.valueUsd as number)} theme={theme} />
                </>
              ) : null}
              <Stat label={t('entry')} value={formatPrice(share.entryPrice)} theme={theme} />
              <Stat label={t(share.sold ? 'exit' : 'now')} value={formatPrice(share.currentPrice)} theme={theme} />
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-2xl p-2.5" style={{ background: theme.panel }}>
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-lg bg-white p-1" />
              )}
              <span className="min-w-0 font-body text-[0.68rem] leading-snug">
                <span className="block" style={{ color: theme.muted }}>
                  {t('tradeWithMe')}
                </span>
                <span className="block truncate font-semibold" style={{ color: theme.up }}>
                  {link}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center justify-between">
            <div role="radiogroup" aria-label={t('look')} className="flex items-center gap-2.5">
              {(Object.keys(THEMES) as ThemeId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={themeId === id}
                  aria-label={id}
                  onClick={() => setThemeId(id)}
                  className={cn('h-8 w-8 rounded-full border-2 transition-transform', themeId === id ? 'scale-110 border-accent' : 'border-white/15')}
                  style={{ background: THEMES[id].swatch }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tU('close_d3d2')}
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: theme.panel, color: theme.muted }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => void shareImage()} className="rounded-xl bg-accent py-3 font-display text-sm font-bold text-black disabled:opacity-50">
              {t('share')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveImage()}
              className="rounded-xl py-3 font-display text-sm font-bold disabled:opacity-50"
              style={{ background: theme.panel, color: theme.text }}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Stat({ label, value, theme }: { label: string; value: string; theme: CardTheme }) {
  return (
    <div>
      <p style={{ color: theme.muted }}>{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
