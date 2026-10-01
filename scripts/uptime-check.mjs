// Production health check, run every 10 minutes by .github/workflows/uptime.yml (and by hand:
// `node scripts/uptime-check.mjs`). Exits non-zero when anything a user would notice is
// broken, so GitHub emails the team. No dependencies — Node 20's fetch only.
const SITE = process.env.SITE_URL ?? 'https://kambesh.com';
const API = process.env.API_URL ?? 'https://api-production-a88d.up.railway.app';
/** Prices older than this mean an ingestion worker has stalled for that chain. */
const MAX_PRICE_AGE_MIN = { 'eip155:8453': 30, 'eip155:56': 30, solana: 30 };
const CHAIN_NAMES = { 'eip155:8453': 'Base', 'eip155:56': 'BNB', solana: 'Solana' };

const results = [];
async function check(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - start, detail });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - start, detail: error instanceof Error ? error.message : String(error) });
  }
}

async function get(url, timeoutMs = 20_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'kamby-uptime-check' } });
  return res;
}

await check('Website home page', async () => {
  const res = await get(`${SITE}/`);
  const body = await res.text();
  if (res.status !== 200) throw new Error(`HTTP ${res.status}${/Error 1\d{3}/.test(body) ? ` (Cloudflare ${body.match(/Error (1\d{3})/)[1]})` : ''}`);
  if (!/kamby/i.test(body)) throw new Error('page rendered without Kamby content');
  return 'HTTP 200';
});

await check('API health (database + redis)', async () => {
  const res = await get(`${API}/health`);
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200 || body.status !== 'ok') throw new Error(`HTTP ${res.status} ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return 'ok';
});

await check('Prices are updating on every chain', async () => {
  const res = await get(`${API}/v1/market/discover?limit=100`);
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
  const markets = await res.json();
  const newest = {};
  for (const m of markets) {
    const at = m.lastPriceUpdateAt ? Date.parse(m.lastPriceUpdateAt) : NaN;
    if (Number.isFinite(at) && (!newest[m.chainIdentifier] || at > newest[m.chainIdentifier])) newest[m.chainIdentifier] = at;
  }
  const stale = [];
  const parts = [];
  for (const [chain, maxMin] of Object.entries(MAX_PRICE_AGE_MIN)) {
    const ageMin = newest[chain] ? (Date.now() - newest[chain]) / 60_000 : Infinity;
    parts.push(`${CHAIN_NAMES[chain]} ${Number.isFinite(ageMin) ? `${ageMin.toFixed(0)}m` : 'none'}`);
    if (ageMin > maxMin) stale.push(`${CHAIN_NAMES[chain]} (${Number.isFinite(ageMin) ? `${ageMin.toFixed(0)} min old` : 'no prices'})`);
  }
  if (stale.length) throw new Error(`stale prices: ${stale.join(', ')}`);
  return `newest price age: ${parts.join(', ')}`;
});

await check('Live market stream (SSE)', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API}/v1/market/feeds/stream`, { signal: controller.signal, headers: { accept: 'text/event-stream' } });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const reader = res.body.getReader();
    let text = '';
    while (!/^event:/m.test(text)) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed before any event');
      text += new TextDecoder().decode(value);
    }
    return 'events flowing';
  } catch (error) {
    if (controller.signal.aborted) throw new Error('no event within 15s');
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
});

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? '✅' : '❌'} ${r.name} — ${r.detail} (${r.ms}ms)`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Kamby production check\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed.`);
  process.exit(1);
}
