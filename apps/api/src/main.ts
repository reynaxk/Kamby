import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { startRpcUsageReporter } from '@kamby/chain-adapters';
import { prisma } from '@kamby/db';
import { AppModule } from './app.module';
import type { Env } from './config/env';
import { initErrorReporting } from './observability/error-reporting';

// Before Nest boots, so a crash during startup is reported too. Read straight from the
// environment (ConfigService doesn't exist yet); SENTRY_DSN is still validated by the env
// schema once it does.
initErrorReporting({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
  release: process.env.RAILWAY_GIT_COMMIT_SHA,
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());

  const allowedOrigins = config
    .get('CORS_ORIGIN', { infer: true })
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on port ${port} (${config.get('NODE_ENV', { infer: true })})`);

  // Paid-RPC visibility (2026-10-01, QuickNode limit hit): calls by provider + method, every 10 min.
  startRpcUsageReporter((message, entries) => logger.log({ rpcUsage: entries }, message));

  // Capacity visibility (2026-09-30): how many Postgres connections every Kamby service holds
  // together vs. the server's own limit — the per-process pools (api 15, workers 5 each) must
  // stay well under it. Informational only; a failure here never affects startup.
  // Only client backends count against max_connections (background workers such as
  // Timescale's don't), and superuser_reserved_connections of those slots are held back.
  prisma
    .$queryRaw<{ max: number; reserved: number; clients: number; background: number }[]>`
      SELECT current_setting('max_connections')::int AS max,
             current_setting('superuser_reserved_connections')::int AS reserved,
             count(*) FILTER (WHERE backend_type = 'client backend')::int AS clients,
             count(*) FILTER (WHERE backend_type <> 'client backend')::int AS background
      FROM pg_stat_activity`
    .then(([row]) => row && logger.log(`Postgres connections: ${row.clients} client of ${row.max} max (${row.reserved} reserved for superusers; ${row.background} background processes not counted)`))
    .catch(() => undefined);
}

bootstrap();
