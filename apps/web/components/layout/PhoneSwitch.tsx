'use client';

import type { ReactNode } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';

/** Renders the phone app screen below `lg`, the desktop layout from `lg` up — only one of
 *  them is ever mounted, so live charts/streams never run twice. */
export function PhoneSwitch({ phone, desktop }: { phone: ReactNode; desktop: ReactNode }) {
  return <>{useIsMobile() ? phone : desktop}</>;
}
