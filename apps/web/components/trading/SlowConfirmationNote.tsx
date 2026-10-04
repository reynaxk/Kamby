'use client';

import { useEffect, useState } from 'react';

/** After `afterMs` of waiting, reassures the user the trade is still tracked (2026-10-04 audit). */
export function SlowConfirmationNote({ afterMs = 45_000 }: { afterMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  if (!show) return null;
  return (
    <p className="font-body text-xs text-ink-400">
      Taking longer than usual — the network is busy. It&apos;s safe to close this; we keep tracking the trade and it shows up in your Trades either way.
    </p>
  );
}
