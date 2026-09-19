import { Skeleton } from '@/components/market/Skeleton';

/**
 * `/trader/[address]` has real server-side data fetching (`await fetchTraderProfile(...)`
 * in the page component), so its own dedicated loading.tsx is required regardless of theme
 * — it shadows the root `app/loading.tsx` fallback (shared by `/` and `/leaderboard`) so
 * this route's Suspense fallback is never generic. As of the visual overhaul this page is
 * `kamby-void`-themed like every other page, so this file now wraps itself the same way.
 * Kept deliberately simple (a handful of generic blocks, not a pixel-exact match of every
 * stat tile).
 */
export default function TraderProfileLoading() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-full" />
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-6 h-40 w-full rounded-2xl" />
        <Skeleton className="mt-6 h-56 w-full rounded-2xl" />
      </div>
    </div>
  );
}
