import { redirect } from 'next/navigation';

/** The watchlist is a tab in Explore now (2026-11-01). */
export default function Page(): never {
  redirect('/explore?tab=watchlist');
}
