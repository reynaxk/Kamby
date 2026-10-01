import { clientIp, isTrustedSsrRequest } from './client-throttler.guard';

describe('ClientThrottlerGuard helpers', () => {
  it("keys on the visitor's real IP from Railway's edge, not the proxy's socket address", () => {
    expect(clientIp({ ip: '100.64.0.18', headers: { 'x-real-ip': '217.174.52.155', 'x-forwarded-for': '217.174.52.155, 95.173.199.194' } })).toBe('217.174.52.155');
    expect(clientIp({ ip: '100.64.0.18', headers: { 'x-forwarded-for': '1.2.3.4, 95.173.199.194' } })).toBe('1.2.3.4');
    expect(clientIp({ ip: '100.64.0.18', headers: {} })).toBe('100.64.0.18');
  });

  it('exempts only requests carrying the exact configured SSR token', () => {
    const token = 'x'.repeat(40);
    expect(isTrustedSsrRequest({ headers: { 'x-kamby-ssr': token } }, token)).toBe(true);
    expect(isTrustedSsrRequest({ headers: { 'x-kamby-ssr': 'x'.repeat(39) } }, token)).toBe(false);
    expect(isTrustedSsrRequest({ headers: {} }, token)).toBe(false);
    expect(isTrustedSsrRequest({ headers: { 'x-kamby-ssr': token } }, undefined)).toBe(false);
  });
});
