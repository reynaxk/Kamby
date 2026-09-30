import type { ArgumentsHost} from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { reportError } from '../../observability/error-reporting';
import { AllExceptionsFilter } from './all-exceptions.filter';

jest.mock('../../observability/error-reporting', () => ({ reportError: jest.fn() }));

function createHost(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/v1/example?wallet=0xabc', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter', () => {
  const originalEnv = process.env.NODE_ENV;
  const logger = { setContext: jest.fn(), error: jest.fn() } as unknown as PinoLogger;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.clearAllMocks();
  });

  it('reports an unexpected error to error tracking with its method and path, never the query string', () => {
    const filter = new AllExceptionsFilter(logger);
    const error = new Error('boom');

    filter.catch(error, createHost().host);

    expect(reportError).toHaveBeenCalledWith(error, { method: 'GET', path: '/v1/example' });
  });

  it('never reports a 4xx the caller caused', () => {
    new AllExceptionsFilter(logger).catch(new HttpException('Token not found', HttpStatus.NOT_FOUND), createHost().host);

    expect(reportError).not.toHaveBeenCalled();
  });

  it('passes through an HttpException status and message unchanged', () => {
    const filter = new AllExceptionsFilter(logger);
    const { host, json, status } = createHost();

    filter.catch(new HttpException('Token not found', HttpStatus.NOT_FOUND), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: HttpStatus.NOT_FOUND, message: 'Token not found' }),
    );
  });

  it('hides an unrecognized error behind a generic message in production', () => {
    process.env.NODE_ENV = 'production';
    const filter = new AllExceptionsFilter(logger);
    const { host, json, status } = createHost();

    filter.catch(new Error('leaked internal detail: connection string xyz'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Internal server error' }));
  });

  it('surfaces the real error message outside production, for local debugging', () => {
    process.env.NODE_ENV = 'development';
    const filter = new AllExceptionsFilter(logger);
    const { host, json } = createHost();

    filter.catch(new Error('boom'), host);

    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }));
  });
});
