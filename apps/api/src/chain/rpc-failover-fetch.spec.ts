import { failoverFetch, isUnusable } from './rpc-failover-fetch';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('failoverFetch', () => {
  it('keeps the primary answer when it is fine', async () => {
    const base = jest.fn().mockResolvedValueOnce(json({ result: 1 }));
    const res = await failoverFetch('https://fallback', undefined, base)('https://primary', { method: 'POST' });
    expect(await res.json()).toEqual({ result: 1 });
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('repeats the call on the fallback when the primary is rate limited, out of credits or down', async () => {
    for (const first of [json({}, 429), json({ error: { code: -32007, message: 'limit' } }), Promise.reject(new Error('ECONNRESET'))]) {
      const onFailover = jest.fn();
      const base = jest.fn().mockImplementationOnce(() => first).mockResolvedValueOnce(json({ result: 2 }));
      const res = await failoverFetch('https://fallback', onFailover, base)('https://primary', { method: 'POST', body: '{}' });
      expect(await res.json()).toEqual({ result: 2 });
      expect(base).toHaveBeenLastCalledWith('https://fallback', { method: 'POST', body: '{}' });
      expect(onFailover).toHaveBeenCalledTimes(1);
    }
  });

  it('treats ordinary RPC errors as answers, not outages', async () => {
    expect(await isUnusable(json({ error: { code: -32602, message: 'bad params' } }))).toBe(false);
    expect(await isUnusable(json({}, 400))).toBe(false);
  });
});
