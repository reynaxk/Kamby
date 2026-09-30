'use client';

import { useState } from 'react';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';
import { LegalModal, type LegalDocument } from './LegalModal';

/**
 * "By signing in, you agree to…" under every sign-in button, opening the documents in a
 * modal. Renders nothing until the legal documents are published (LEGAL_DETAILS_CONFIRMED)
 * — never a link to terms that aren't live.
 */
export function LegalAgreementNote({ action = 'signing in' }: { action?: string }) {
  const [open, setOpen] = useState<LegalDocument | null>(null);
  if (!LEGAL_DETAILS_CONFIRMED) return null;
  const linkClass = 'text-ink-600 underline decoration-line underline-offset-2 hover:text-ink-900';
  return (
    <>
      <p className="mt-2 text-center font-body text-[0.7rem] text-ink-400">
        By {action}, you agree to Kamby&apos;s{' '}
        <button type="button" className={linkClass} onClick={() => setOpen('terms')}>
          Terms of Service
        </button>{' '}
        and{' '}
        <button type="button" className={linkClass} onClick={() => setOpen('privacy')}>
          Privacy Policy
        </button>
        .
      </p>
      <LegalModal open={open !== null} initialDocument={open ?? 'terms'} onClose={() => setOpen(null)} />
    </>
  );
}
