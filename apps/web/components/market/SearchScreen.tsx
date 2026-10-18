'use client';

import { useCallback, useState } from 'react';
import { SearchBar } from './SearchBar';

/** The Search tab's body: the big search field, and the page's own lists (recent, trending)
 *  that step aside while you're searching — results take their place. */
export function SearchScreen({ children }: { children: React.ReactNode }) {
  const [searching, setSearching] = useState(false);
  const onActive = useCallback((a: boolean) => setSearching(a), []);
  return (
    <>
      <div className="px-4">
        <SearchBar screen onActiveChange={onActive} />
      </div>
      <div className={searching ? 'hidden' : undefined}>{children}</div>
    </>
  );
}
