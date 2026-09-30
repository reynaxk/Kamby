import * as Sentry from '@sentry/node';
import { initErrorReporting, isErrorReportingEnabled, reportError } from './error-reporting';

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  withScope: jest.fn((fn: (scope: { setTag: jest.Mock; setContext: jest.Mock }) => void) => fn({ setTag: jest.fn(), setContext: jest.fn() })),
}));

describe('error reporting', () => {
  it('stays off, sending nothing, when no DSN is configured', () => {
    expect(initErrorReporting({ dsn: undefined, environment: 'production' })).toBe(false);
    reportError(new Error('boom'), { method: 'GET', path: '/v1/x' });

    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(isErrorReportingEnabled()).toBe(false);
  });

  it('initializes errors-only with no personal data when a DSN is set, then reports', () => {
    expect(initErrorReporting({ dsn: 'https://key@o1.ingest.sentry.io/1', environment: 'production', release: 'abc123' })).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(expect.objectContaining({ tracesSampleRate: 0, sendDefaultPii: false, environment: 'production', release: 'abc123' }));

    const error = new Error('boom');
    reportError(error, { method: 'POST', path: '/v1/trade/quote' });
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
