'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Clock, TriangleAlert, X } from 'lucide-react';
import { cn } from '@kamby/ui';

export type TerminalToastVariant = 'pending' | 'success' | 'error';

export interface TerminalToast {
  id: string;
  variant: TerminalToastVariant;
  title: string;
  description?: string;
  /** A Solscan link for the transaction this toast is about, if one exists yet — a
   *  `pending` toast usually won't have one until the signature comes back. */
  solscanUrl?: string;
}

interface ToastContextValue {
  push: (toast: Omit<TerminalToast, 'id'>) => string;
  /** Updates an existing toast in place (e.g. `pending` -> `success`) instead of stacking a
   *  second one for the same trade — every caller here tracks one toast per submission. */
  update: (id: string, patch: Partial<Omit<TerminalToast, 'id'>>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Auto-dismiss only applies to terminal states — a `pending` toast stays until the caller
 *  updates or dismisses it, since "still waiting" shouldn't silently disappear. */
const AUTO_DISMISS_MS = 6000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<TerminalToast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const scheduleAutoDismiss = useCallback(
    (id: string, variant: TerminalToastVariant) => {
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      if (variant === 'pending') return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      );
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: Omit<TerminalToast, 'id'>) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { ...toast, id }]);
      scheduleAutoDismiss(id, toast.variant);
      return id;
    },
    [scheduleAutoDismiss],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<TerminalToast, 'id'>>) => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      if (patch.variant) scheduleAutoDismiss(id, patch.variant);
    },
    [scheduleAutoDismiss],
  );

  const value = useMemo(() => ({ push, update, dismiss }), [push, update, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useTerminalToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useTerminalToast must be used within a ToastProvider');
  return ctx;
}

const VARIANT_STYLES: Record<TerminalToastVariant, { icon: typeof CheckCircle2; accent: string }> = {
  pending: { icon: Clock, accent: 'text-warn' },
  success: { icon: CheckCircle2, accent: 'text-up' },
  error: { icon: TriangleAlert, accent: 'text-down' },
};

function ToastCard({ toast, onDismiss }: { toast: TerminalToast; onDismiss: () => void }) {
  const { icon: Icon, accent } = VARIANT_STYLES[toast.variant];
  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-line bg-surface p-3 shadow-lg shadow-black/40">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', accent, toast.variant === 'pending' && 'animate-pulse')} />
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-ink-900">{toast.title}</p>
        {toast.description && <p className="mt-0.5 font-body text-xs text-ink-600">{toast.description}</p>}
        {toast.solscanUrl && (
          <a
            href={toast.solscanUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-block font-mono text-xs text-accent underline"
          >
            View on Solscan
          </a>
        )}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="text-ink-400 hover:text-ink-900">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
