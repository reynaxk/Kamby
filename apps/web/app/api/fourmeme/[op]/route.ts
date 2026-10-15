/**
 * Kamby's LaunchPad → Four.meme (2026-10-15). Four.meme's API refuses Kamby's servers (403 from
 * Railway) and browsers can't send its `meme-web-access` header cross-origin, so the creator's
 * browser calls it through here (Cloudflare). Only the four create-flow calls are passed on; the
 * access token is the creator's own Four.meme session and is never stored.
 */
const UPSTREAM = 'https://four.meme/meme-api/v1/private';
const OPS: Record<string, string> = {
  nonce: '/user/nonce/generate',
  login: '/user/login/dex',
  upload: '/token/upload',
  create: '/token/create',
};

export async function POST(req: Request, { params }: { params: { op: string } }) {
  // The public launch settings (raise tokens), same reason as below.
  if (params.op === 'config') {
    const res = await fetch('https://four.meme/meme-api/v1/public/config', { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return new Response(res ? await res.text() : '{}', { status: res?.status ?? 502, headers: { 'content-type': 'application/json' } });
  }
  const path = OPS[params.op];
  if (!path) return Response.json({ message: 'Not found' }, { status: 404 });
  const headers = new Headers();
  const access = req.headers.get('meme-web-access');
  if (access) headers.set('meme-web-access', access);
  const type = req.headers.get('content-type');
  if (type) headers.set('content-type', type);
  headers.set('accept', 'application/json');
  const upstream = await fetch(`${UPSTREAM}${path}`, { method: 'POST', headers, body: await req.arrayBuffer(), signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!upstream) return Response.json({ message: "Four.meme didn't answer — try again in a moment." }, { status: 502 });
  return new Response(await upstream.text(), { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
}
