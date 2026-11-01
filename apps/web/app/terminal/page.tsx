import { redirect } from 'next/navigation';

/** The Trade terminal was removed 2026-11-01 (owner): Hunt and Explore replaced it; each coin keeps its own page with Buy/Sell. */
export default function Page(): never {
  redirect('/hunt');
}
