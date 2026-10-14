import { env } from '@/lib/env';

/**
 * Kamby's LaunchPad: a created coin's logo (`/launch-assets/<id>`) and metadata JSON
 * (`/launch-assets/<launchId>.json`) — the on-chain `uri` points here, so wallets, Pump.fun and
 * explorers read it from kambesh.com. Proxied from the API, cached at the edge.
 */
export async function GET(_req: Request, { params }: { params: { file: string } }) {
  const match = /^([0-9a-f-]{36})(\.json)?$/i.exec(params.file);
  if (!match) return new Response('Not found', { status: 404 });
  const [, id, json] = match;
  const upstream = await fetch(`${env.API_BASE_URL}/v1/launchpad/${json ? 'metadata' : 'assets'}/${id}`, {
    signal: AbortSignal.timeout(10_000),
    headers: env.API_SSR_TOKEN ? { 'x-kamby-ssr': env.API_SSR_TOKEN } : undefined,
  }).catch(() => null);
  if (!upstream || !upstream.ok) return new Response('Not found', { status: upstream?.status === 404 ? 404 : 502 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? (json ? 'application/json' : 'application/octet-stream'),
      'Cache-Control': json ? 'public, max-age=300' : 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
