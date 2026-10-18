import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** Details some screens still pass in English — shown in the reader's language instead. */
const KNOWN_DETAILS: Record<string, string> = {
  "Try again in a moment.": "tryAgain",
  "Try selecting the token again in a moment.": "tryToken",
  "Your BUY/SELL trades will show up here once you make one.": "tradesEmpty",
  "Watch a token from its page to track its price and activity here.": "watchEmpty",
  "This isn't one of your recorded trades.": "tradeNotYours",
  "The ingestion worker hasn't published a priced snapshot for any tracked market. Check back shortly.": "marketsWarming",
  "Switch to Live or 10s to watch it move in real time.": "switchLive",
  "Sign in and watch a token to start tracking it here.": "signInWatch",
  "Recent traders on this token will show up here.": "tradersEmpty",
  "Price/volume alerts are planned but don't exist yet — nothing to show here honestly.": "alertsSoon",
  "Follows, likes, and trade alerts will show up here.": "notifsEmpty",
  "Follow traders and engage with trades to start seeing activity here.": "notifsFollow",
  "Follow a trader to start seeing their activity, alongside general market discovery.": "feedFollow",
  "Follow a trader or make a trade to start seeing picks tailored to you.": "picksFollow",
  "Discover traders in Top Traders or the activity feed, and follow them to build your feed.": "discoverTraders",
  "Connect a wallet to start a session.": "connectSession",
  "Connect a wallet and trade to start tracking this.": "connectTrack",
  "Connect a wallet and make your first trade to see it here.": "connectFirstTrade",
  "Check back once more tokens or traders pick up pace.": "risingEmpty",
};

/**
 * Kamby's empty / couldn't-load state (2026-10-18 redesign, owner audit: the old dashed grey box
 * looked unfinished) — a glass card with an icon tile, the title, a line of detail and, when
 * there's an obvious next step, one button for it. `tone="error"` swaps in the warning icon.
 */
export function EmptyState({
  title,
  detail,
  tone = 'empty',
  action,
  icon,
}: {
  title: string;
  detail?: string;
  tone?: 'empty' | 'error';
  action?: { label: string; href: string };
  icon?: React.ReactNode;
}) {
  const tE = useTranslations('empty');
  const known = detail ? KNOWN_DETAILS[detail] : undefined;
  const isError = tone === 'error' || known === 'tryAgain' || known === 'tryToken';
  const text = known ? tE(known) : detail;
  return (
    <div className="kamby-glass relative flex flex-col items-center justify-center overflow-hidden rounded-3xl px-6 py-10 text-center">
      <span
        className={
          isError
            ? 'flex h-12 w-12 items-center justify-center rounded-2xl border border-warn/25 bg-warn/[0.08] text-warn'
            : 'flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-ink-400'
        }
        aria-hidden
      >
        {icon ??
          (isError ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z" />
            </svg>
          ))}
      </span>
      <p className="mt-4 font-display text-base font-bold text-ink-900">{title}</p>
      {text && <p className="mt-1 max-w-sm font-body text-sm leading-snug text-ink-400">{text}</p>}
      {action && (
        <Link href={action.href} className="mt-5 rounded-2xl bg-accent px-5 py-2.5 font-display text-sm font-bold text-black transition-transform active:scale-[0.97]">
          {action.label}
        </Link>
      )}
    </div>
  );
}
