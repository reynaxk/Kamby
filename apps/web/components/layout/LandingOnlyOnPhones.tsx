'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';

/** Phones are app screens (2026-10-10) — no website footer under them, except on the landing
 *  page. The language picker lives on the Profile screen there. */
export function LandingOnlyOnPhones({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  return <div className={pathname === '/' ? undefined : 'max-md:hidden'}>{children}</div>;
}
