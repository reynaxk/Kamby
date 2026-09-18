import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { getSolanaConfig, type Env } from '../config/env';
import { SolanaConnectionPool, SOLANA_CONNECTION_POOL } from './solana-connection-pool';

/**
 * One shared, failover-aware Solana connection pool for the whole process — see
 * solana-connection-pool.ts's own doc comment. Global so every module (SolanaModule today,
 * anything else that needs Solana RPC access later) can inject SOLANA_CONNECTION_POOL
 * without importing ChainModule directly, same convention as RedisModule/REDIS_CLIENT.
 * `null` when SOLANA_ENABLED is false — every injector must handle that case explicitly,
 * same convention getSolanaConfig() itself already established.
 */
@Global()
@Module({
  providers: [
    {
      provide: SOLANA_CONNECTION_POOL,
      inject: [ConfigService, PinoLogger],
      useFactory: (config: ConfigService<Env, true>, logger: PinoLogger): SolanaConnectionPool | null => {
        logger.setContext('SolanaConnectionPool');
        const solanaConfig = getSolanaConfig((key) => config.get(key, { infer: true }));
        if (!solanaConfig) return null;
        return new SolanaConnectionPool(solanaConfig.rpcUrl, solanaConfig.rpcUrlFallback, logger);
      },
    },
  ],
  exports: [SOLANA_CONNECTION_POOL],
})
export class ChainModule {}
