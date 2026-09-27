import { Surface } from '@kamby/ui';
import Link from 'next/link';

/** kamby-void here — same real gap as app/error.tsx (see that file's own comment): this
 *  boundary runs inside the root layout, which already has Tailwind/void tokens loaded, so
 *  there's no structural reason for it to fall back to the light theme. Confirmed live: a
 *  real not-found navigation (e.g. /trader/<a valid but unregistered address>) rendered this
 *  in plain light mode, a jarring inconsistency against every other page. */
export default function NotFound() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <Surface className="w-full p-8">
          <h1 className="font-display text-lg font-bold text-ink-900">Page not found</h1>
          <p className="mt-2 text-sm text-ink-600">There&apos;s nothing here yet.</p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold text-accent hover:underline">
            Back home
          </Link>
        </Surface>
      </main>
    </div>
  );
}
