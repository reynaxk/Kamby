import { redirect } from 'next/navigation';

/** Home was removed 2026-11-01 (owner): Trenches is the start page now. Your balance and coins live in Profile. */
export default function Page(): never {
  redirect('/trenches');
}
