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
