// Cloudflare Workers config for Next.js via OpenNext — see
// https://opennext.js.org/cloudflare. Deliberately no incremental cache override for now:
// this app's pages already fetch live data from the API on every request (short
// `revalidate` windows, not long-lived static generation), so skipping the R2-backed
// incremental cache avoids needing to provision an R2 bucket before the first deploy. Add
// one later (see the commented-out block in wrangler.jsonc) if build-time ISR caching
// becomes worth the extra setup.
import { defineCloudflareConfig } from '@opennextjs/cloudflare/config';

export default defineCloudflareConfig({});
