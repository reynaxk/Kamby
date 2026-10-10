'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'kamby:install-dismissed-at';
/** A dismissed banner stays away this long. */
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function recentlyDismissed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(DISMISSED_KEY) ?? 0) < DISMISS_MS;
  } catch {
    return false;
  }
}

/**
 * Installable Kamby (PWA, 2026-10-09). Registers the service worker, and on phones shows a small
 * banner: Android gets a real "Install" button (Chrome's prompt), iPhone gets the two-step
 * Share → "Add to Home Screen" hint, since Safari has no install prompt. Hidden once installed,
 * on desktop, and for two weeks after "Not now".
 */
export function InstallApp() {
  const tU = useTranslations('ui');
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const pathname = usePathname() ?? '';
  const [ios, setIos] = useState(false);
  const [visible, setVisible] = useState(false);
  const t = useTranslations('install');

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
    if (isStandalone() || recentlyDismissed()) return;
    const mobile = window.matchMedia('(max-width: 768px)').matches;
    if (!mobile) return;
    const ua = navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (isIos) {
      setIos(true);
      setVisible(true);
      return;
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => setVisible(false);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Not over a coin screen's Buy/Sell bar.
  if (!visible || pathname.startsWith('/solana') || pathname.startsWith('/market/')) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      // private mode — it just shows again next visit
    }
  };
  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (outcome === 'accepted') setVisible(false);
    setPrompt(null);
  };

  return (
    <div
      role="dialog"
      aria-label={tU('installKamby_e7f9')}
      className="fixed inset-x-3 bottom-44 z-[60] flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-3 shadow-2xl backdrop-blur"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/kamby-app-icon-512.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold text-ink-900">{t('title')}</p>
        <p className="font-body text-xs text-ink-600">
          {ios
            ? t.rich('iosText', {
                share: () => <span className="font-semibold text-ink-900">{t('iosShare')} ⬆︎</span>,
                add: () => <span className="font-semibold text-ink-900">{t('iosAdd')}</span>,
              })
            : t('android')}
        </p>
      </div>
      {!ios && prompt && (
        <button type="button" onClick={() => void install()} className="shrink-0 rounded-xl bg-accent px-3.5 py-2 font-display text-xs font-bold text-black">
          {t('install')}
        </button>
      )}
      <button type="button" onClick={dismiss} aria-label={tU('notNow_3049')} className="shrink-0 rounded-lg px-2 py-1 font-body text-xs text-ink-400 hover:text-ink-900">
        {t('notNow')}
      </button>
    </div>
  );
}
