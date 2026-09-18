import { MarketHeader } from '@/components/market/MarketHeader';
import { ProfileEditor } from '@/components/account/ProfileEditor';

export const metadata = { title: 'Your profile — Kamby' };

/** Entirely client-rendered below the header, same reasoning as app/watchlist/page.tsx:
 *  the session lives in localStorage, invisible to a Server Component. */
export default function AccountPage() {
  return (
    <>
      <MarketHeader />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="font-display text-xl font-bold text-ink-900">Your profile</h1>
        <p className="mt-1 font-body text-sm text-ink-600">
          Your username and picture appear on the leaderboard and your trader profile.
        </p>
        <div className="mt-6">
          <ProfileEditor />
        </div>
      </main>
    </>
  );
}
