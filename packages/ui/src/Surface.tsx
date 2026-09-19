import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './cn';

export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` (default) is today's look, unchanged — every existing call site that doesn't
   *  pass this prop renders byte-identically to before. `glass` formalizes the glassmorphic
   *  treatment the leaderboard page originated (keyed off `ink-900` rather than a hardcoded
   *  white, so it adapts correctly outside the Void theme too, not just on a near-black
   *  background). `elevated` is a neutral, non-tinted shadow for generic depth — colored
   *  glow (shadow-glow-accent/up/down) stays something callers compose via className at the
   *  specific spots that want emphasis, not another variant here. */
  variant?: 'flat' | 'glass' | 'elevated';
}

const VARIANT_CLASSES: Record<NonNullable<SurfaceProps['variant']>, string> = {
  flat: 'rounded-2xl border border-line bg-surface',
  glass: 'rounded-2xl border border-ink-900/[0.06] bg-ink-900/[0.03] backdrop-blur-glass',
  elevated: 'rounded-2xl border border-line bg-surface shadow-[0_8px_30px_-12px_rgb(0_0_0/0.5)]',
};

/** The one card-like container the app reuses instead of redefining borders/radius/shadow ad hoc. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant = 'flat', ...props }, ref) => {
    return <div ref={ref} className={cn(VARIANT_CLASSES[variant], className)} {...props} />;
  },
);

Surface.displayName = 'Surface';
