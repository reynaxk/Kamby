import { Skeleton } from './Skeleton';

/** A coin's phone screen while it loads (2026-10-10): the same shape as MobileCoinScreen —
 *  app bar, price, chart, tabs, Buy/Sell — so tapping a coin feels instant, like an app,
 *  instead of a page of generic grey boxes. */
export function CoinScreenSkeleton() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="flex items-center gap-2 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
        <span className="h-10 w-10" />
        <Skeleton className="h-9 w-9 rounded-full" />
        <span className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-28" />
        </span>
      </div>
      <div className="flex items-start justify-between px-4 pt-1">
        <span className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-20" />
        </span>
        <span className="space-y-2 text-right">
          <Skeleton className="ml-auto h-5 w-20" />
          <Skeleton className="ml-auto h-3 w-16" />
        </span>
      </div>
      <Skeleton className="mt-3 h-[300px] w-full rounded-none opacity-60" />
      <div className="mt-6 flex gap-6 border-b border-white/10 px-6 pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-12" />
      </div>
      <div className="space-y-4 px-4 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
      <div className="fixed inset-x-0 bottom-0 flex gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-6">
        <span className="h-14 flex-[2] rounded-2xl bg-up/40" />
        <span className="h-14 flex-1 rounded-2xl bg-surface-raised" />
      </div>
    </div>
  );
}
