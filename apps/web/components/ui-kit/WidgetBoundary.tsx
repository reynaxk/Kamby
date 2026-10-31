'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { reloadIfStaleDeploy } from '@/lib/reload-on-stale-deploy';

/**
 * Keeps one widget's crash inside that widget (2026-10-31): a chart, the holders list or a trade
 * panel that throws — a provider answering something unexpected, a timeout mid-render — shows a
 * small "didn't load · Retry" card in its own place, and the rest of the coin page keeps working.
 * Retry remounts the widget, so it fetches again from scratch. A stale-deploy chunk error still
 * reloads the page once (lib/reload-on-stale-deploy).
 */
export class WidgetBoundary extends Component<
  { name: string; children: ReactNode; className?: string },
  { failed: boolean; attempt: number }
> {
  override state = { failed: false, attempt: 0 };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (reloadIfStaleDeploy(error)) return;
    // eslint-disable-next-line no-console
    console.error(`Widget "${this.props.name}" crashed`, { message: error.message, stack: info.componentStack?.slice(0, 500) });
  }

  private retry = () => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));

  override render() {
    if (this.state.failed) return <WidgetFailed className={this.props.className} onRetry={this.retry} />;
    // The key makes Retry a real fresh start (new state, new requests), not a re-render of the broken tree.
    return <WidgetSlot key={this.state.attempt}>{this.props.children}</WidgetSlot>;
  }
}

function WidgetSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function WidgetFailed({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const tU = useTranslations('ui');
  return (
    <div role="alert" className={cn('flex min-h-[7rem] flex-col items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface p-4 text-center', className)}>
      <p className="font-body text-sm text-ink-600">{tU('widgetFailed')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-full border border-line bg-white/[0.04] px-4 py-1.5 font-display text-xs font-bold text-ink-900 transition-colors hover:border-accent/50 hover:text-accent"
      >
        {tU('retry_6327')}
      </button>
    </div>
  );
}
