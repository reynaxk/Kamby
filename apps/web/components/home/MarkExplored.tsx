'use client';

import { useEffect } from 'react';
import { markStep } from '@/lib/onboarding';

/** Ticks Getting started's "look around" step on a server-rendered page (the Feed). */
export function MarkExplored() {
  useEffect(() => markStep('explored'), []);
  return null;
}
