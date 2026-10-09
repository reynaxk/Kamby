import Link from 'next/link';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';
import { LanguageSelect } from '@/components/i18n/LanguageSelect';

const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/risk', label: 'Risk disclosure' },
] as const;

/** Site-wide legal links — own kamby-void scope like TickerBar, since it renders under pages
 *  that may not all share one theme wrapper. Hidden until the documents are published
 *  (LEGAL_DETAILS_CONFIRMED) — the pages 404 until then. */
export function SiteFooter() {
  // The language picker is always here (2026-10-09) — the only place a signed-out visitor
  // can change it; the legal part still waits for LEGAL_DETAILS_CONFIRMED.
  return (
    <footer className="kamby-void border-t border-line bg-bg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 font-mono text-[0.7rem] text-ink-400">
        {LEGAL_DETAILS_CONFIRMED && <p>Trading crypto is risky. Kamby is non-custodial and nothing here is financial advice.</p>}
        <div className="flex flex-wrap items-center gap-4">
          {LEGAL_DETAILS_CONFIRMED && (
            <nav className="flex gap-4">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="hover:text-ink-900">
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
          <LanguageSelect className="w-52 text-xs" />
        </div>
      </div>
    </footer>
  );
}
