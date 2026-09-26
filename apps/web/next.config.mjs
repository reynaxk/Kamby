/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Back-compat for the old chain-less /market/:address route, retired 2026-09-16 when BNB
  // Chain going live required disambiguating which chain a token address belongs to (see
  // app/market/[chain]/[address]/page.tsx, the real page now). A page-level redirect at
  // app/market/[address]/page.tsx isn't possible here — Next's router rejects two dynamic
  // routes at the same URL position with different segment names ('address' vs 'chain'),
  // so this has to live in config instead. Resolves to DEFAULT_CHAIN_SLUG (Base), the same
  // back-compat assumption DEFAULT_CHAIN_ID already encodes everywhere else.
  async redirects() {
    return [
      {
        source: '/market/:address',
        destination: '/market/base/:address',
        permanent: false,
      },
    ];
  },
  // Baseline security headers — none of these existed before (confirmed via a live `curl -I`
  // against kambesh.com, which returned no security headers at all beyond Cloudflare's own
  // defaults). Deliberately scoped to headers with no real risk of breaking anything: no
  // Content-Security-Policy or Permissions-Policy here yet, since a wrong CSP could silently
  // break Privy's auth iframe, wagmi/viem RPC calls, or Google Fonts — that needs a careful,
  // separate allowlisting pass across every third party this app actually depends on, not a
  // header bolted on alongside an unrelated audit finding.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // 2 years, includeSubDomains — the standard HSTS preload-list minimum. Forces
          // HTTPS for every future visit, closing the window a downgrade attack needs.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // Stops a browser from executing a response as a different content-type than the
          // server declared (e.g. treating an uploaded profile picture as executable JS).
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // SAMEORIGIN, not DENY: blocks the real threat (another site iframing Kamby for
          // clickjacking) without foreclosing a legitimate same-origin embed later.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Never leaks the full URL (which can carry a session-bearing query string) to a
          // cross-origin destination — only the origin. Same-origin navigation still gets
          // the full referrer.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  webpack: (config, { webpack }) => {
    // wagmi's connectors barrel (wagmi/connectors) unconditionally re-exports Coinbase's
    // baseAccount/coinbaseWallet connectors alongside the ones this app actually uses (see
    // lib/wagmi-config.ts). Those pull in @coinbase/cdp-sdk's optional x402-payments code
    // path, which statically imports @x402/* packages this app never installs — it doesn't
    // use in-wallet payments — and Next's webpack build otherwise fails trying to resolve
    // them. Never constructing those connectors isn't enough to avoid this: ES module
    // imports are resolved for the whole file graph before tree-shaking removes anything.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    // Same story for @metamask/sdk (pulled in by the same barrel's metaMask connector,
    // also unused here — see lib/wagmi-config.ts): its React Native storage backend is
    // optional and irrelevant to a web bundle, but not installing it otherwise produces a
    // (non-fatal, but noisy) "Module not found" build warning.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@react-native-async-storage\// }));
    return config;
  },
};

export default nextConfig;
