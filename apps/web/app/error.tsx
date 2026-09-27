'use client';

import { Button, Surface } from '@kamby/ui';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled route error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    // kamby-void here, unlike global-error.tsx: this boundary runs inside the root layout
    // (which already loaded Tailwind/the void tokens fine, or we'd never have reached this
    // component at all — see global-error.tsx's own comment on why *that* one can't rely on
    // any of this). Without it, any unhandled crash on an otherwise-dark page fell back to a
    // plain light-mode card — a real, jarring inconsistency at exactly the moment something's
    // already gone wrong for the user.
    <div className="kamby-void min-h-screen bg-bg">
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Surface className="w-full p-8">
          <h1 className="font-display text-lg font-bold text-ink-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-ink-600">
            The page hit an unexpected error. It&apos;s been logged — try again.
          </p>
          <Button className="mt-6" onClick={() => reset()}>
            Try again
          </Button>
        </Surface>
      </main>
    </div>
  );
}
