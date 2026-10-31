'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@kamby/ui';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';
import { LegalModal } from './LegalModal';

/**
 * "By signing in, you agree to our Terms of Service and confirm that you are at
 * least 18…" under the sign-in buttons (owner, 2026-10-31), the Terms opening in a modal. Privy's
 * own modal links the Terms too (`legal` in lib/privy-config.ts). Renders nothing until the
 * legal documents are published (LEGAL_DETAILS_CONFIRMED) — never a link to terms that aren't live.
 */
export function LegalAgreementNote({ className }: { className?: string }) {
  const t = useTranslations('legal');
  const [open, setOpen] = useState(false);
  if (!LEGAL_DETAILS_CONFIRMED) return null;
  return (
    <>
      <p className={cn('mx-auto mt-3 flex max-w-[22rem] items-start justify-center gap-1.5 text-center font-body text-[0.7rem] leading-relaxed text-ink-400 [text-wrap:balance]', className)}>
        <svg aria-hidden viewBox="0 0 16 16" className="mt-[0.2rem] h-3 w-3 shrink-0 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 1.5 2.75 3.5v4c0 3.2 2.2 5.9 5.25 7 3.05-1.1 5.25-3.8 5.25-7v-4L8 1.5Z" />
          <path d="m5.75 8 1.6 1.6 2.9-3.1" />
        </svg>
        <span>
          {t.rich('agree', {
            terms: (chunks) => (
              <button
                type="button"
                className="font-semibold text-ink-700 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-accent hover:decoration-accent/60"
                onClick={() => setOpen(true)}
              >
                {chunks}
              </button>
            ),
          })}
        </span>
      </p>
      <LegalModal open={open} initialDocument="terms" onClose={() => setOpen(false)} />
    </>
  );
}
