'use client';

import { useState } from 'react';
import { cn } from '@kamby/ui';
import { WidgetBoundary } from '@/components/ui-kit/WidgetBoundary';

/**
 * A trader profile's tabs (2026-10-30 redesign, owner's concepts): Trades / Posts / Coins in one
 * place instead of stacked sections. Every tab's content is rendered once and only hidden, so a
 * switch is instant and the server-rendered lists stay as they are.
 */
export function ProfileTabs({ tabs }: { tabs: { key: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-6 border-b border-line px-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              'h-11 font-display text-sm font-bold transition-colors',
              active === t.key ? 'text-ink-900 shadow-[inset_0_-2px_0_rgb(var(--kamby-accent))]' : 'text-ink-400 hover:text-ink-900',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} role="tabpanel" hidden={active !== t.key}>
          <WidgetBoundary name={`tab:${t.key}`}>{t.content}</WidgetBoundary>
        </div>
      ))}
    </div>
  );
}
