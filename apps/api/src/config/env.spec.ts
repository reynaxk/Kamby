import { parseEnv } from '@kamby/domain';
import { EnvSchema, ValidatedEnvSchema, getConfiguredChains, getSolanaConfig, type Env } from './env';

/** A real generic function declaration (not an arrow lambda) so it satisfies
 *  getConfiguredChains' `<K extends keyof Env>(key: K) => Env[K]` parameter type — a plain
 *  `(key: keyof Env) => env[key]` arrow function only returns the flattened union `Env[keyof
 *  Env]`, which TypeScript won't narrow back to the per-call `Env[K]` it's asked for. */
function envGetter(env: Env) {
  return <K extends keyof Env>(key: K): Env[K] => env[key];
}

describe('API env schema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kamby',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SECRET: 'a-test-secret-at-least-16-chars',
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: '8453',
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    PLATFORM_FEE_RECIPIENT_ADDRESS: '0x1234567890123456789012345678901234567890',
  };

  it('accepts a minimal valid configuration and fills in defaults', () => {
    const env = parseEnv(ValidatedEnvSchema, validBase);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(env.PLATFORM_FEE_BPS).toBe(50);
  });

  it('fails clearly when DATABASE_URL is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'DATABASE_URL'))).toThrowError(/DATABASE_URL/);
  });

  it('fails clearly when REDIS_URL is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'REDIS_URL'))).toThrowError(/REDIS_URL/);
  });

  it('fails clearly when JWT_SECRET is missing', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'JWT_SECRET'))).toThrowError(/JWT_SECRET/);
  });

  it('fails clearly when JWT_SECRET is too short', () => {
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, JWT_SECRET: 'short' })).toThrowError(/JWT_SECRET/);
  });

  it('coerces PORT from a string env value to a number', () => {
    const env = parseEnv(ValidatedEnvSchema, { ...validBase, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  describe('multi-chain config (CHAINS + CHAIN_<SLUG>_*)', () => {
    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_ID', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_ID'))).toThrowError(/CHAIN_BASE_ID/);
    });

    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_RPC_URL', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_RPC_URL'))).toThrowError(/CHAIN_BASE_RPC_URL/);
    });

    it('rejects a malformed CHAIN_<SLUG>_RPC_URL', () => {
      expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, CHAIN_BASE_RPC_URL: 'not-a-url' })).toThrowError(/CHAIN_BASE_RPC_URL/);
    });

    it('fails clearly when a slug listed in CHAINS has no CHAIN_<SLUG>_USDC_ADDRESS', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'CHAIN_BASE_USDC_ADDRESS'))).toThrowError(/CHAIN_BASE_USDC_ADDRESS/);
    });

    it('rejects a malformed CHAIN_<SLUG>_USDC_ADDRESS', () => {
      expect(() =>
        parseEnv(ValidatedEnvSchema, { ...validBase, CHAIN_BASE_USDC_ADDRESS: 'not-an-address' }),
      ).toThrowError(/CHAIN_BASE_USDC_ADDRESS/);
    });

    it('rejects an unknown chain slug in CHAINS rather than silently ignoring it', () => {
      expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, CHAINS: 'base,solana' })).toThrowError(/solana/);
    });

    it('rejects a DEFAULT_CHAIN_SLUG that is not itself listed in CHAINS', () => {
      expect(() =>
        parseEnv(ValidatedEnvSchema, {
          ...validBase,
          DEFAULT_CHAIN_SLUG: 'arbitrum',
          CHAIN_ARBITRUM_ID: '42161',
          CHAIN_ARBITRUM_RPC_URL: 'https://arb1.arbitrum.io/rpc',
          CHAIN_ARBITRUM_USDC_ADDRESS: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        }),
      ).toThrowError(/DEFAULT_CHAIN_SLUG/);
    });

    it('accepts two fully-configured chains', () => {
      const env = parseEnv(ValidatedEnvSchema, {
        ...validBase,
        CHAINS: 'base,arbitrum',
        CHAIN_ARBITRUM_ID: '42161',
        CHAIN_ARBITRUM_RPC_URL: 'https://arb1.arbitrum.io/rpc',
        CHAIN_ARBITRUM_USDC_ADDRESS: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      });
      expect(getConfiguredChains(envGetter(env)).map((c) => c.slug)).toEqual(['base', 'arbitrum']);
    });

    it("does not require Arbitrum's variables when only base is listed in CHAINS", () => {
      expect(() => parseEnv(ValidatedEnvSchema, validBase)).not.toThrow();
    });

    it('accepts BNB Chain fully configured alongside Base', () => {
      const env = parseEnv(ValidatedEnvSchema, {
        ...validBase,
        CHAINS: 'base,bnb',
        CHAIN_BNB_ID: '56',
        CHAIN_BNB_RPC_URL: 'https://bsc-dataseed.binance.org',
        CHAIN_BNB_USDC_ADDRESS: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      });
      const chains = getConfiguredChains(envGetter(env));
      expect(chains.map((c) => c.slug)).toEqual(['base', 'bnb']);
      expect(chains.find((c) => c.slug === 'bnb')).toMatchObject({ chainId: 56, rpcUrl: 'https://bsc-dataseed.binance.org' });
    });

    it('fails clearly when bnb is listed in CHAINS but CHAIN_BNB_ID is missing', () => {
      expect(() =>
        parseEnv(ValidatedEnvSchema, {
          ...validBase,
          CHAINS: 'base,bnb',
          CHAIN_BNB_RPC_URL: 'https://bsc-dataseed.binance.org',
          CHAIN_BNB_USDC_ADDRESS: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
        }),
      ).toThrowError(/CHAIN_BNB_ID/);
    });
  });

  describe('getConfiguredChains', () => {
    it('returns exactly one entry per slug in CHAINS, with the right fields resolved', () => {
      const env = parseEnv(ValidatedEnvSchema, validBase);
      const chains = getConfiguredChains(envGetter(env));
      expect(chains).toEqual([
        {
          slug: 'base',
          chainId: 8453,
          rpcUrl: 'https://mainnet.base.org',
          rpcUrlFallback: null,
          usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        },
      ]);
    });

    it('resolves a configured fallback RPC URL instead of null', () => {
      const env = parseEnv(ValidatedEnvSchema, { ...validBase, CHAIN_BASE_RPC_URL_FALLBACK: 'https://base-fallback.example.com' });
      const chains = getConfiguredChains(envGetter(env));
      expect(chains[0]?.rpcUrlFallback).toBe('https://base-fallback.example.com');
    });
  });

  describe('Solana config (SOLANA_ENABLED + SOLANA_*)', () => {
    it('requires nothing Solana-shaped when SOLANA_ENABLED is left at its default (false)', () => {
      expect(() => parseEnv(ValidatedEnvSchema, validBase)).not.toThrow();
      const env = parseEnv(ValidatedEnvSchema, validBase);
      expect(getSolanaConfig(envGetter(env))).toBeNull();
    });

    const solanaBase = {
      ...validBase,
      SOLANA_ENABLED: 'true',
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      SOLANA_TREASURY_USDC_ATA: 'FakeAtaAddressForTestingOnly1111111111111',
      SOLANA_TOPUP_FUNDING_SECRET_KEY: 'fake-base58-secret-key-for-testing-only',
      SOLANA_JUPITER_API_KEY: 'fake-jupiter-api-key-for-testing-only',
    };

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_RPC_URL is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_RPC_URL'))).toThrowError(/SOLANA_RPC_URL/);
    });

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_TREASURY_USDC_ATA is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_TREASURY_USDC_ATA'))).toThrowError(/SOLANA_TREASURY_USDC_ATA/);
    });

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_TOPUP_FUNDING_SECRET_KEY is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_TOPUP_FUNDING_SECRET_KEY'))).toThrowError(
        /SOLANA_TOPUP_FUNDING_SECRET_KEY/,
      );
    });

    it('fails clearly when SOLANA_ENABLED is true but SOLANA_JUPITER_API_KEY is missing', () => {
      expect(() => parseEnv(ValidatedEnvSchema, omit(solanaBase, 'SOLANA_JUPITER_API_KEY'))).toThrowError(
        /SOLANA_JUPITER_API_KEY/,
      );
    });

    it('defaults SOLANA_JUPITER_PLATFORM_FEE_BPS to 50 (0.50%), matching the EVM side', () => {
      const env = parseEnv(ValidatedEnvSchema, solanaBase);
      expect(env.SOLANA_JUPITER_PLATFORM_FEE_BPS).toBe(50);
    });

    it('getSolanaConfig resolves every field once SOLANA_ENABLED is true and fully configured', () => {
      const env = parseEnv(ValidatedEnvSchema, solanaBase);
      expect(getSolanaConfig(envGetter(env))).toEqual({
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        rpcUrlFallback: null,
        treasuryUsdcAta: 'FakeAtaAddressForTestingOnly1111111111111',
        jupiterPlatformFeeBps: 50,
        newWalletTopupSol: 0.01,
        topupFundingSecretKey: 'fake-base58-secret-key-for-testing-only',
        jupiterApiKey: 'fake-jupiter-api-key-for-testing-only',
        gasRelayerFeePayerSecretKey: null,
        gasRelayerMaxLamportsCeiling: null,
        gasRelayerTestWalletAddresses: null,
      });
    });

    it('resolves a configured Solana fallback RPC URL instead of null', () => {
      const env = parseEnv(ValidatedEnvSchema, { ...solanaBase, SOLANA_RPC_URL_FALLBACK: 'https://solana-fallback.example.com' });
      expect(getSolanaConfig(envGetter(env))?.rpcUrlFallback).toBe('https://solana-fallback.example.com');
    });

    it('gasRelayer* fields resolve when set, unlike every other required SOLANA_* field — genuinely optional unless SOLANA_GAS_RELAYER_ENABLED is true', () => {
      const env = parseEnv(ValidatedEnvSchema, {
        ...solanaBase,
        SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: 'fake-relayer-secret-key',
        SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING: '3000000',
      });
      const config = getSolanaConfig(envGetter(env));
      expect(config?.gasRelayerFeePayerSecretKey).toBe('fake-relayer-secret-key');
      expect(config?.gasRelayerMaxLamportsCeiling).toBe(3_000_000);
    });

    describe('gas relayer (SOLANA_GAS_RELAYER_ENABLED)', () => {
      it('requires nothing gas-relayer-shaped when SOLANA_GAS_RELAYER_ENABLED is left at its default (false)', () => {
        expect(() => parseEnv(ValidatedEnvSchema, solanaBase)).not.toThrow();
      });

      const relayerBase = {
        ...solanaBase,
        SOLANA_GAS_RELAYER_ENABLED: 'true',
        SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: 'fake-relayer-secret-key',
        SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING: '3000000',
      };

      it('accepts a fully-configured, enabled gas relayer', () => {
        expect(() => parseEnv(ValidatedEnvSchema, relayerBase)).not.toThrow();
      });

      it('fails clearly when SOLANA_GAS_RELAYER_ENABLED is true but SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY is missing', () => {
        expect(() => parseEnv(ValidatedEnvSchema, omit(relayerBase, 'SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY'))).toThrowError(
          /SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY/,
        );
      });

      it('fails clearly when SOLANA_GAS_RELAYER_ENABLED is true but SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING is missing', () => {
        expect(() => parseEnv(ValidatedEnvSchema, omit(relayerBase, 'SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING'))).toThrowError(
          /SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING/,
        );
      });

      it('fails clearly when SOLANA_GAS_RELAYER_ENABLED is true but SOLANA_ENABLED is false — never a silent no-op', () => {
        // z.coerce.boolean() treats any non-empty string (including the literal "false") as
        // truthy — omitting the key is the only way to actually get SOLANA_ENABLED to
        // resolve to its false default, same convention every other test in this file uses.
        expect(() => parseEnv(ValidatedEnvSchema, omit(relayerBase, 'SOLANA_ENABLED'))).toThrowError(/SOLANA_GAS_RELAYER_ENABLED requires SOLANA_ENABLED/);
      });

      describe('test-wallet rollout gate (SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES)', () => {
        it('resolves to null (no restriction) when unset', () => {
          const env = parseEnv(ValidatedEnvSchema, relayerBase);
          expect(getSolanaConfig(envGetter(env))?.gasRelayerTestWalletAddresses).toBeNull();
        });

        it('parses a comma-separated list into a Set, trimming whitespace and dropping empty entries', () => {
          const env = parseEnv(ValidatedEnvSchema, { ...relayerBase, SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: ' WalletA111 , WalletB222,,WalletC333 ' });
          expect(getSolanaConfig(envGetter(env))?.gasRelayerTestWalletAddresses).toEqual(new Set(['WalletA111', 'WalletB222', 'WalletC333']));
        });

        it('is entirely independent of SOLANA_GAS_RELAYER_ENABLED — never required, never validated against it', () => {
          expect(() => parseEnv(ValidatedEnvSchema, { ...solanaBase, SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: 'WalletA111' })).not.toThrow();
        });
      });
    });
  });

  it('defaults KYBERSWAP_CLIENT_ID to "kamby" when unset — KyberSwap requires no API key', () => {
    const env = parseEnv(ValidatedEnvSchema, validBase);
    expect(env.KYBERSWAP_CLIENT_ID).toBe('kamby');
  });

  it('accepts a custom KYBERSWAP_CLIENT_ID override', () => {
    const env = parseEnv(ValidatedEnvSchema, { ...validBase, KYBERSWAP_CLIENT_ID: 'kamby-prod' });
    expect(env.KYBERSWAP_CLIENT_ID).toBe('kamby-prod');
  });

  it('fails clearly when PLATFORM_FEE_RECIPIENT_ADDRESS is missing or malformed', () => {
    expect(() => parseEnv(ValidatedEnvSchema, omit(validBase, 'PLATFORM_FEE_RECIPIENT_ADDRESS'))).toThrowError(
      /PLATFORM_FEE_RECIPIENT_ADDRESS/,
    );
    expect(() =>
      parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_RECIPIENT_ADDRESS: 'not-an-address' }),
    ).toThrowError(/PLATFORM_FEE_RECIPIENT_ADDRESS/);
  });

  it('defaults PLATFORM_FEE_BPS to 50 (0.50%) and accepts an override within range', () => {
    expect(parseEnv(ValidatedEnvSchema, validBase).PLATFORM_FEE_BPS).toBe(50);
    expect(parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '75' }).PLATFORM_FEE_BPS).toBe(75);
  });

  it('rejects a PLATFORM_FEE_BPS outside the sane configured range', () => {
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '-1' })).toThrow();
    expect(() => parseEnv(ValidatedEnvSchema, { ...validBase, PLATFORM_FEE_BPS: '10000' })).toThrow();
  });
});

// Sanity check that the bare (unrefined) EnvSchema still validates the fields that don't
// depend on cross-field chain configuration — ValidatedEnvSchema above covers the rest.
describe('EnvSchema (unrefined)', () => {
  it('fails clearly when DATABASE_URL is missing, independent of chain config', () => {
    expect(() => parseEnv(EnvSchema, { REDIS_URL: 'redis://localhost:6379' })).toThrowError(/DATABASE_URL/);
  });
});

function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const clone = { ...obj };
  delete clone[key];
  return clone;
}
