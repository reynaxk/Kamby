import Link from 'next/link';
import { MarketHeader } from '@/components/market/MarketHeader';
import { LEGAL_DETAILS_CONFIRMED, LEGAL_LAST_UPDATED } from '@/lib/legal';

/** Shared shell for /terms, /privacy and /risk — plain, readable long-form text. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <Link href="/" className="font-mono text-xs text-ink-400 hover:text-ink-900">
          ← Back to Discover
        </Link>
        <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        <p className="mt-1 font-mono text-xs text-ink-400">Last updated {LEGAL_LAST_UPDATED}</p>
        {!LEGAL_DETAILS_CONFIRMED && (
          <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-body text-xs text-warn">
            Draft — operator details on this page are pending confirmation.
          </p>
        )}
        <div className="legal-prose mt-8 space-y-6 font-body text-sm leading-relaxed text-ink-600 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink-900 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink-900">
          {children}
        </div>
      </main>
    </div>
  );
}
