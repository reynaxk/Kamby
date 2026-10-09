import createNextIntlPlugin from 'next-intl/plugin';

// Languages (i18n/request.ts) — 2026-10-09.
const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

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
  // defaults).
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
          // Content-Security-Policy — added 2026-09-27 after surveying the real production
          // bundle (grepped every deployed chunk for literal external hostnames, not
          // guessed) rather than the "could break Privy/RPC/fonts" fear that deferred this
          // earlier tonight. Two directives are deliberately loose, for real reasons found
          // during that survey, not laziness:
          //   - connect-src: WalletConnect/Reown's SDK bundles fallback RPC endpoints across
          //     dozens of chains/providers (infura.io, alchemy.com, drpc.org, publicnode.com,
          //     walletconnect.{com,org} subdomains, Helius, Jito, ...) that vary by which
          //     wallet/chain a user picks — there is no fixed, enumerable list to allowlist.
          //   - img-src: token logoUrl values are whatever the ingestion pipeline's data
          //     source (DexScreener, etc.) returns, an open set by design (see
          //     docs/MARKET_DATA.md) — can't allowlist a domain that doesn't exist yet.
          // script-src/object-src/base-uri/form-action/frame-src ARE tightly scoped — those
          // are the directives that actually stop injected-script and clickjacking-iframe
          // attacks, so looseness elsewhere doesn't make this a no-op header.
          // 'unsafe-inline' is required on both script-src (Next.js App Router streams RSC
          // payloads via inline <script>self.__next_f.push(...)</script> tags) and style-src
          // (Sparkline.tsx and others set inline `style={{ width, height }}`) — removing it
          // needs a per-request nonce wired through middleware, a real follow-up, not
          // something to half-do here. Verified against a real Chromium session (Playwright)
          // hitting every major page — zero CSP violations in the console — before this
          // shipped, not assumed from reading code alone.
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
              "object-src 'none'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' https: data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
              'upgrade-insecure-requests',
            ].join('; '),
          },
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

export default withNextIntl(nextConfig);
