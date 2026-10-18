import { cn } from '@kamby/ui';

/**
 * Placeholder rows while a list loads (2026-10-18 audit: a bare grey "Loading…" line under a
 * tab looked broken). The label stays for screen readers. `avatar={false}` for lists of plain rows.
 */
export function ListSkeleton({ label, rows = 5, avatar = true, className }: { label: string; rows?: number; avatar?: boolean; className?: string }) {
  return (
    <div role="status" className={cn('divide-y divide-white/[0.04]', className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="flex items-center gap-3 px-4 py-3" style={{ opacity: 1 - i * 0.14 }}>
          {avatar && <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/[0.06]" />}
          <span className="min-w-0 flex-1 space-y-2">
            <span className="block h-3 w-2/5 animate-pulse rounded bg-white/[0.07]" />
            <span className="block h-2.5 w-1/4 animate-pulse rounded bg-white/[0.05]" />
          </span>
          <span className="w-16 shrink-0 space-y-2">
            <span className="ml-auto block h-3 w-full animate-pulse rounded bg-white/[0.07]" />
            <span className="ml-auto block h-2.5 w-2/3 animate-pulse rounded bg-white/[0.05]" />
          </span>
        </div>
      ))}
    </div>
  );
}
