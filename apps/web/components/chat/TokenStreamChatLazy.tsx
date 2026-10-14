'use client';

import dynamic from 'next/dynamic';

/** The coin chat, loaded after the page (it isn't needed for the first paint — keeps the coin
 *  screen as fast as before). */
export const TokenStreamChatLazy = dynamic(() => import('./TokenStreamChat').then((m) => m.TokenStreamChat), {
  ssr: false,
  loading: () => <div className="h-full" />,
});
