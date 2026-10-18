'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function CopyAddressButton({ address }: { address: string }) {
  const tU = useTranslations('ui');
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — nothing useful to recover into,
      // the address is still shown in full via the title attribute on the caller.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-body text-[0.68rem] font-semibold text-ink-400 transition-colors hover:border-accent/40 hover:text-accent"
      title={address}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
      {copied ? tU('copied_a588') : tU('copy_5fb6')}
    </button>
  );
}
