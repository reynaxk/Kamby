import { cn } from '@kamby/ui';

/**
 * The Kamby mark (since 2026-10-13: a black K with a rising arrow cut out of a neon tile —
 * public/brand/kamby-mark.svg, generated with every app icon by apps/web/scripts/gen-logo.cjs — redrawn as a
 * vector from the brand mockup, 2026-09-30) + the "KAMBY" wordmark, used everywhere the
 * logo appears (MarketHeader, WelcomePage, loading states, footers). Renders just the mark
 * and the wordmark, not a wrapping element — callers keep their own wrapper (a
 * `<Link href="/">` in MarketHeader, a plain `<div>` elsewhere), since "is this clickable"
 * is a per-caller concern the logo itself shouldn't decide.
 */
export function KambyLogo({ size = 'md' }: { size?: 'sm' | 'md' } = {}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static SVG; next/image adds nothing here */}
      <img src="/brand/kamby-mark.svg" alt="" aria-hidden className={size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'} />
      <span
        className={cn(
          'font-display font-extrabold uppercase tracking-wide text-ink-900',
          size === 'sm' ? 'text-base' : 'text-lg',
        )}
      >
        Kamby
      </span>
    </>
  );
}
