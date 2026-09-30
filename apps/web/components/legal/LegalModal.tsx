'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X } from 'lucide-react';
import { cn } from '@kamby/ui';
import { LEGAL_DETAILS_CONFIRMED, LEGAL_LAST_UPDATED } from '@/lib/legal';
import { PrivacyContent } from './PrivacyContent';
import { TermsContent } from './TermsContent';

export type LegalDocument = 'terms' | 'privacy';

const DOCUMENTS: Record<LegalDocument, { title: string; href: string; Content: () => React.JSX.Element }> = {
  terms: { title: 'Terms of Service', href: '/terms', Content: TermsContent },
  privacy: { title: 'Privacy Policy', href: '/privacy', Content: PrivacyContent },
};

/**
 * Terms of Service / Privacy Policy in a modal, so reading them never takes someone out of a
 * sign-in or trade — the same text /terms and /privacy render (one copy, see TermsContent/
 * PrivacyContent). Tabs switch between the two; Escape or the backdrop closes it.
 */
export function LegalModal({ open, initialDocument = 'terms', onClose }: { open: boolean; initialDocument?: LegalDocument; onClose: () => void }) {
  const [document_, setDocument] = useState<LegalDocument>(initialDocument);

  useEffect(() => {
    if (open) setDocument(initialDocument);
  }, [open, initialDocument]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  const { title, href, Content } = DOCUMENTS[document_];

  return createPortal(
    <div className="kamby-void fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-modal-title"
        className="relative flex max-h-[85vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-xl sm:max-w-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div role="tablist" aria-label="Legal documents" className="flex gap-4">
            {(Object.keys(DOCUMENTS) as LegalDocument[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={document_ === key}
                onClick={() => setDocument(key)}
                className={cn('font-mono text-xs uppercase tracking-tight', document_ === key ? 'text-ink-900' : 'text-ink-400 hover:text-ink-600')}
              >
                {DOCUMENTS[key].title}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-400 hover:text-ink-900">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <h2 id="legal-modal-title" className="font-display text-lg font-bold text-ink-900">
            {title}
          </h2>
          <p className="mt-0.5 font-mono text-[0.65rem] text-ink-400">
            Last updated {LEGAL_LAST_UPDATED} ·{' '}
            <Link href={href} className="text-accent hover:underline" onClick={onClose}>
              Open full page
            </Link>
          </p>
          {!LEGAL_DETAILS_CONFIRMED && (
            <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-body text-xs text-warn">
              Draft — operator details are pending confirmation.
            </p>
          )}
          <div className="mt-4 space-y-5 font-body text-sm leading-relaxed text-ink-600 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink-900">
            <Content />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
