import { Skeleton } from '@/components/market/Skeleton';

/**
 * The Suspense fallback for every top-level route with no more specific `loading.tsx` of
 * its own — concretely, today, that's only `/` (Discover) and `/leaderboard`: every other
 * route either has its own dedicated `loading.tsx` (`/market/[chain]/[address]`,
 * `/trader/[address]`) or never suspends at all (it's entirely client-rendered below
 * `MarketHeader`, with no server-side `await` in the page component to suspend on — see
 * e.g. `app/trades/page.tsx`'s own doc comment). Both routes this actually serves are
 * `kamby-void`-themed (see `app/page.tsx`/`app/leaderboard/page.tsx`), so this wraps itself
 * in the same class — previously it didn't, so every cold load of the app's two highest-
 * traffic Void pages flashed the light/system-dark background for a beat before the real
 * page mounted and re-skinned it. If a future non-Void route ever starts sharing this
 * fallback (i.e. gains real server-side data fetching with no `loading.tsx` of its own),
 * give it its own dedicated `loading.tsx` instead of reverting this — see
 * `app/trader/[address]/loading.tsx` for exactly that pattern already in place.
 */
export default function Loading() {
  return (
    <div className="kamby-void min-h-screen bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>

        <Skeleton className="mt-12 h-7 w-48" />
        <div className="mt-6 space-y-2">
          <Skeleton className="h-12 w-full rounded-xl" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>

        <Skeleton className="mt-12 h-5 w-24" />
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
