import { cn } from '@kamby/ui';

/**
 * The 🔥 + "Kamby" wordmark — previously copy-pasted verbatim in four places
 * (MarketHeader, WelcomePage's own header, HomeGate's loading state, WelcomeClosingCta's
 * footer), two of them already drifting to a smaller `size="sm"` variant for the footer.
 * Renders just the two `<span>`s, not a wrapping element — callers keep their own wrapper
 * (a `<Link href="/">` in MarketHeader, a plain `<div>` elsewhere), since "is this
 * clickable" is a per-caller concern the logo itself shouldn't decide.
 */
export function KambyLogo({ size = 'md' }: { size?: 'sm' | 'md' } = {}) {
  return (
    <>
      <span aria-hidden className={size === 'sm' ? 'text-lg' : 'text-xl'}>
        🔥
      </span>
      <span
        className={cn(
          'font-display font-extrabold tracking-tight text-ink-900',
          size === 'sm' ? 'text-base' : 'text-lg',
        )}
      >
        Kamby
      </span>
    </>
  );
}
