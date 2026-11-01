import { redirect } from 'next/navigation';

/** Trending lives in Explore now (2026-11-01). */
export default function Page(): never {
  redirect('/explore');
}
