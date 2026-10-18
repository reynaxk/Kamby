'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * A profile picture that falls back instead of breaking (2026-10-18: a picture that failed to
 * load — a blocked or expired URL — showed the browser's broken-image icon, so it looked like
 * the user had no picture at all). Renders `fallback` when there's no URL or it fails to load.
 */
export function SafeImg({ src, className, fallback }: { src: string | null | undefined; className?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- user pictures come from anywhere
  return <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={className} />;
}
