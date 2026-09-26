'use client';

import { useEffect } from 'react';

/**
 * The one error boundary `error.tsx` structurally cannot be — Next.js only invokes
 * `global-error.tsx` when the error originates in the root layout itself (`layout.tsx`,
 * `providers.tsx`) rather than a child route segment, and *replaces* the root layout
 * entirely when it fires, which is why this renders its own `<html>`/`<body>` — there is no
 * outer layout left to supply them.
 *
 * Deliberately dependency-free: no `@kamby/ui`, no Tailwind classes, no import of anything
 * this app's own providers touch. If `Providers` (Privy/wagmi/query-client init) is what
 * threw, a version of this page that itself depended on component-library styling or the
 * same provider tree would risk failing to render for the same reason — plain inline styles
 * only, so this stays renderable no matter what broke above it. Same reasoning `error.tsx`
 * doesn't need: a route-segment error still has a working root layout underneath it.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled root-layout error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#080A0F', color: '#F3F5F8', fontFamily: 'system-ui, sans-serif' }}>
        <main
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '1.5rem',
            textAlign: 'center',
          }}
        >
          <div style={{ maxWidth: '28rem', width: '100%', border: '1px solid #1F2530', borderRadius: '1rem', padding: '2rem', background: '#0E1015' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>Something went wrong</h1>
            <p style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#9AA3B2' }}>
              Kamby hit an unexpected error loading this page. It&apos;s been logged — try again.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: '1.5rem',
                background: '#22C55E',
                color: '#04110A',
                border: 'none',
                borderRadius: '0.75rem',
                padding: '0.625rem 1.25rem',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
