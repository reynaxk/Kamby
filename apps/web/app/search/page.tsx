import { SearchBar } from '@/components/market/SearchBar';

export const metadata = { title: 'Search — Kamby' };

/** The app's Search tab (2026-10-09): Kamby's coin search, full-width, results as you type. */
export default function SearchPage() {
  return (
    <main className="kamby-void mx-auto min-h-screen max-w-2xl bg-bg px-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
      <SearchBar />
    </main>
  );
}
