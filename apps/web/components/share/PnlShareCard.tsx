'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { MobileDrawer } from '@/components/layout/MobileDrawer';
import { TokenAvatar } from '@/components/market/TokenAvatar';
import { formatPrice } from '@/lib/format';
import { fetchMyReferralSummary } from '@/lib/referrals-client';

export interface PnlShare {
  symbol: string | null;
  logoUrl: string | null;
  seed: string;
  pnlUsd: number;
  pnlPct: number | null;
  entryPrice: number | null;
  currentPrice: number | null;
}

/**
 * A shareable PnL card (2026-10-09 app redesign, after fomo's portfolio card): the coin, the
 * profit in % and $, entry vs now, and the trader's referral link — drawn in the browser and
 * shared as a PNG (phone share sheet: Telegram, X, WhatsApp) or downloaded. Every shared win is
 * an invite with the sharer's code.
 */
export function PnlShareButton({ share, className }: { share: PnlShare; className?: string }) {
  const t = useTranslations('share');
  const [open, setOpen] = useState(false);
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

function PnlShareSheet({ share, onClose }: { share: PnlShare; onClose: () => void }) {
  const t = useTranslations('share');
  const cardRef = useRef<HTMLDivElement>(null);
  const [refCode, setRefCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchMyReferralSummary()
      .then((s) => setRefCode(s.referralCode))
      .catch(() => setRefCode(null));
  }, []);

  const link = `kambesh.com${refCode ? `/?ref=${refCode}` : ''}`;
  const up = share.pnlUsd >= 0;
  const pct = share.pnlPct === null ? null : `${share.pnlPct >= 0 ? '+' : ''}${share.pnlPct.toFixed(Math.abs(share.pnlPct) >= 100 ? 0 : 1)}%`;
  const usd = `${share.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(share.pnlUsd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const ticker = `$${(share.symbol ?? 'TOKEN').replace(/^\$+/, '')}`;

  async function render(): Promise<Blob | null> {
    if (!cardRef.current) return null;
    const { toBlob } = await import('html-to-image');
    return toBlob(cardRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: '#05070A' }).catch(() => null);
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

  return (
    <MobileDrawer open onClose={onClose} title={t('sharePnl')}>
      <div className="flex flex-col items-center gap-4">
        <div
          ref={cardRef}
          className="relative w-[320px] overflow-hidden rounded-3xl border border-white/10 p-5"
          style={{ background: up ? 'radial-gradient(120% 90% at 85% 0%, rgba(0,255,135,0.28), transparent 60%), #05070A' : 'radial-gradient(120% 90% at 85% 0%, rgba(239,68,68,0.28), transparent 60%), #05070A' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-lg font-black tracking-tight text-white">KAMBY</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-white/70">{t('pnl')}</span>
          </div>
          <div className="mt-6 flex items-center gap-3">
            <TokenAvatar src={share.logoUrl} seed={share.seed} label={share.symbol} className="h-11 w-11 text-base" />
            <span className="font-display text-2xl font-bold text-white">{ticker}</span>
          </div>
          <p className={cn('mt-4 font-display text-6xl font-black leading-none tracking-tight', up ? 'text-[#00FF87]' : 'text-[#ef4444]')}>{pct ?? usd}</p>
          {pct && <p className={cn('mt-2 font-mono text-lg font-semibold', up ? 'text-[#00FF87]' : 'text-[#ef4444]')}>{usd}</p>}
          <div className="mt-6 grid grid-cols-2 gap-3 font-mono text-xs">
            <div>
              <p className="text-white/50">{t('entry')}</p>
              <p className="mt-0.5 font-semibold text-white">{formatPrice(share.entryPrice)}</p>
            </div>
            <div>
              <p className="text-white/50">{t('now')}</p>
              <p className="mt-0.5 font-semibold text-white">{formatPrice(share.currentPrice)}</p>
            </div>
          </div>
          <div className="mt-6 rounded-2xl bg-white/5 px-3 py-2.5 font-mono text-[0.7rem] text-white/80">
            {t('tradeWithMe')} <span className="font-semibold text-[#00FF87]">{link}</span>
          </div>
        </div>
        <div className="grid w-full max-w-[320px] grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => void shareImage()} className="rounded-xl bg-accent py-3 font-display text-sm font-bold text-black disabled:opacity-50">
            {t('share')}
          </button>
          <button type="button" disabled={busy} onClick={() => void saveImage()} className="rounded-xl border border-line bg-surface-raised py-3 font-display text-sm font-bold text-ink-900 disabled:opacity-50">
            {t('save')}
          </button>
        </div>
      </div>
    </MobileDrawer>
  );
}
