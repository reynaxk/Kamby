import Link from 'next/link';
import { cn } from '@kamby/ui';

/** Traders ⇄ Squads on the Leaders tab (2026-10-17) — a glass segmented switch. */
export function LeaderTabs({ active, traders, squads }: { active: 'traders' | 'squads'; traders: string; squads: string }) {
  const tab = (key: 'traders' | 'squads', href: string, label: string, icon: React.ReactNode) => (
    <Link
      href={href}
      aria-current={active === key ? 'page' : undefined}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 font-display text-sm font-bold transition-colors',
        active === key ? 'bg-white/[0.1] text-ink-900' : 'text-ink-400 hover:text-ink-900',
      )}
    >
      {icon}
      {label}
    </Link>
  );
  return (
    <nav className="mt-4 flex gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] p-1">
      {tab(
        'traders',
        '/leaderboard',
        traders,
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
        </svg>,
      )}
      {tab(
        'squads',
        '/leaderboard/squads',
        squads,
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5 21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2" />
        </svg>,
      )}
    </nav>
  );
}
