import { Skeleton } from '@/components/market/Skeleton';

/** Home while it loads: the balance, the list tabs and coin rows in their real places
 *  (2026-10-10) — not a page of generic boxes. */
export default function HomeLoading() {
  return (
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <div className="flex items-start justify-between px-5 py-4">
        <span className="space-y-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-3 w-24" />
        </span>
        <span className="h-12 w-28 rounded-2xl bg-accent/30" />
      </div>
      <div className="mt-3 flex gap-6 border-b border-white/10 px-6 pb-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex gap-2 px-4 pt-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-5 px-4 pt-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <span className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </span>
            <span className="space-y-2">
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="ml-auto h-3 w-12" />
            </span>
          </div>
        ))}
      </div>
    </main>
  );
}
