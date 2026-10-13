'use client';

import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';

/** After `afterMs` of waiting, reassures the user the trade is still tracked (2026-10-04 audit). */
export function SlowConfirmationNote({ afterMs = 45_000 }: { afterMs?: number }) {
  const tL = useTranslations('labels');
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  if (!show) return null;
  return (
    <p className="font-body text-xs text-ink-400">
      {tL('slowConfirmation')}
    </p>
  );
}
