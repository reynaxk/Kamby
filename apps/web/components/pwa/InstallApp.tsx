'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';

/** Chrome's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Back in the installed app after this long away, it reloads — fresh prices and the newest build. */
const STALE_AFTER_MS = 20 * 60 * 1000;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

// Chrome's prompt, kept from page load until someone taps "Get the app" in Settings.
let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Installable Kamby (PWA, 2026-10-09; reworked 2026-11-01 — owner: the banner was annoying, the
 * app felt slow and stale). Registers the service worker and keeps Chrome's install prompt for
 * the "Get the app" row in Settings — no banner pops up over the app any more. In the installed
 * app it also checks for a new version whenever it comes back to the front, and reloads after
 * 20+ minutes away so nobody trades on a stale screen.
 */
export function InstallApp() {
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker
        .register('/sw.js')
        .then((r) => (registration = r))
        .catch(() => undefined);
    }
    const onPrompt = (event: Event) => {
      event.preventDefault();
      deferred = event as BeforeInstallPromptEvent;
      emit();
    };
    const onInstalled = () => {
      installed = true;
      deferred = null;
      emit();
    };
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      void registration?.update().catch(() => undefined);
      if (hiddenAt && isStandalone() && Date.now() - hiddenAt > STALE_AFTER_MS) window.location.reload();
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return null;
}

/** Settings' "Get the Kamby app" row: Chrome's own install on Android, the two steps on iPhone. */
export function InstallAppRow() {
  const t = useTranslations('install');
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const done = useSyncExternalStore(subscribe, () => installed, () => false);
  const [env, setEnv] = useState<{ standalone: boolean; ios: boolean } | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setEnv({ standalone: isStandalone(), ios: /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua) });
  }, []);

  if (!env || env.standalone || done || (!env.ios && !prompt)) return null;

  const install = async () => {
    if (env.ios) return setShowSteps((v) => !v);
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
    if (outcome === 'accepted') installed = true;
    deferred = null;
    emit();
  };

  return (
    <div>
      <button type="button" onClick={() => void install()} className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-white/5">
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent [&>svg]:h-[18px] [&>svg]:w-[18px]">
          <Download />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-body text-[0.95rem] text-ink-900">{t('title')}</span>
          <span className="block font-body text-xs text-ink-400">{t('android')}</span>
        </span>
        {!env.ios && <span className="rounded-xl bg-accent px-3 py-1.5 font-display text-xs font-bold text-black">{t('install')}</span>}
      </button>
      {env.ios && showSteps && (
        <p className="px-4 pb-3 pl-16 font-body text-sm text-ink-600">
          {t.rich('iosText', {
            share: () => <span className="font-semibold text-ink-900">{t('iosShare')} ⬆︎</span>,
            add: () => <span className="font-semibold text-ink-900">{t('iosAdd')}</span>,
          })}
        </p>
      )}
    </div>
  );
}
