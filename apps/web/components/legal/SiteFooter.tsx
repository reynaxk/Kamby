import Link from 'next/link';
import { LEGAL_DETAILS_CONFIRMED } from '@/lib/legal';

const LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/risk', label: 'Risk disclosure' },
] as const;

/** Site-wide legal links — own kamby-void scope like TickerBar, since it renders under pages
 *  that may not all share one theme wrapper. Hidden until the documents are published
 *  (LEGAL_DETAILS_CONFIRMED) — the pages 404 until then. */
export function SiteFooter() {
  if (!LEGAL_DETAILS_CONFIRMED) return null;
  return (
    <footer className="kamby-void border-t border-line bg-bg">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 font-mono text-[0.7rem] text-ink-400">
        <p>Trading crypto is risky. Kamby is non-custodial and nothing here is financial advice.</p>
        <nav className="flex gap-4">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-ink-900">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
