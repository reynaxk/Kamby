import 'reflect-metadata';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
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

  // Capacity visibility (2026-09-30): how many Postgres connections every Kamby service holds
  // together vs. the server's own limit — the per-process pools (api 15, workers 5 each) must
  // stay well under it. Informational only; a failure here never affects startup.
  prisma
    .$queryRaw<{ max: number; in_use: number }[]>`SELECT current_setting('max_connections')::int AS max, (SELECT count(*)::int FROM pg_stat_activity) AS in_use`
    .then(([row]) => row && logger.log(`Postgres connections in use: ${row.in_use}/${row.max}`))
    .catch(() => undefined);
}

bootstrap();
