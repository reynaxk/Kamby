import { z } from 'zod';
import { SUPPORTED_CHAIN_SLUGS, DEFAULT_CHAIN_SLUG, type ChainSlug } from '@kamby/domain';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Every variable the API genuinely reads at boot. Nothing here is optional-by-accident —
 * a field is only optional/defaulted when running without it is truly fine. Validated once
 * in ConfigModule.forRoot({ validate }); a misconfigured deploy fails at boot with a clear,
 * complete list of what's wrong, not a cryptic error the first time something is used.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (postgres connection string)'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required (redis connection string)'),

  /** Comma-separated list of allowed origins, e.g. "https://kamby.app,http://localhost:3000". */
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  THROTTLE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),

  /**
   * Signs the anonymous session issued by POST /v1/identity/session — see
   * docs/SOCIAL.md#authentication for exactly what this session does and doesn't prove.
   * A missing/weak secret fails loudly at boot, same as every other required var here.
   */
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),

  /**
   * Which chains this deployment actually trades on — a comma-separated list of slugs from
   * @kamby/domain's CHAIN_REGISTRY (e.g. "base,arbitrum"), same convention as CORS_ORIGIN's
   * comma-list. Every slug named here must have its own CHAIN_<SLUG>_* block below fully
   * populated (checked in superRefine, not left to fail at first use). Each slug's own
   * numeric chain id and RPC URL must name the same chain
   * apps/workers/src/config/env.ts's matching CHAIN_<SLUG>_IDENTIFIER (a CAIP-2 string, e.g.
   * "eip155:8453") already indexes — see docs/TRADING.md#chain-scope.
   */
  CHAINS: z.string().min(1).default(DEFAULT_CHAIN_SLUG),
  /** Which of CHAINS a request that omits chainId resolves to — the one back-compat
   *  default every pre-multi-chain caller implicitly meant. */
  DEFAULT_CHAIN_SLUG: z.string().min(1).default(DEFAULT_CHAIN_SLUG),

  /** Numeric chain id — every trading-provider API and wallet library expects a bare EVM
   *  chain id, not Kamby's own CAIP-2 identifier format. */
  CHAIN_BASE_ID: z.coerce.number().int().positive().optional(),
  /** Used for on-chain reads Phase 3 needs directly (transaction receipt status, LI.FI's
   *  allowance check) — never for building the swap itself, which comes fully formed from
   *  the router. */
  CHAIN_BASE_RPC_URL: z.string().url('CHAIN_BASE_RPC_URL must be a valid URL').optional(),
  /** This chain's USDC contract — see USDC_CONTRACT_ADDRESS's old doc comment (removed
   *  below in favor of this, per-chain, version): the one token the guaranteed-USDC-fee
   *  flow treats as "the cash side" on this specific chain. Must name the same token as
   *  apps/workers' matching CHAIN_<SLUG>_USDC_ADDRESS. */
  CHAIN_BASE_USDC_ADDRESS: z.string().regex(EVM_ADDRESS_REGEX, 'CHAIN_BASE_USDC_ADDRESS must be a valid EVM address').optional(),

  CHAIN_ARBITRUM_ID: z.coerce.number().int().positive().optional(),
  CHAIN_ARBITRUM_RPC_URL: z.string().url('CHAIN_ARBITRUM_RPC_URL must be a valid URL').optional(),
  CHAIN_ARBITRUM_USDC_ADDRESS: z
    .string()
    .regex(EVM_ADDRESS_REGEX, 'CHAIN_ARBITRUM_USDC_ADDRESS must be a valid EVM address')
    .optional(),

  /**
   * See docs/TRADING.md#provider. `MetaAggregatorSwapRouter` races LI.FI and 1inch in
   * parallel and takes the better-priced result, so both keys below are required — not an
   * either/or. Validated here (not left to fail at first use) so a misconfigured deploy is
   * loud at boot, same as every other required var. A missing key means quotes honestly
   * fail rather than falling back to an invented price — this is deliberate even though
   * both providers have their own free tiers; a silently-absent key should never be
   * mistaken for "running on the free tier as intended."
   */
  LIFI_API_KEY: z.string().min(1, 'LIFI_API_KEY is required for real swap quotes'),
  /**
   * The integrator identity registered at https://portal.li.fi — LI.FI routes the
   * platform fee to whatever wallet is configured there under this name, not to an
   * address passed per-request. `PLATFORM_FEE_RECIPIENT_ADDRESS` below must match what's
   * registered in that portal for the two to actually agree — see docs/TRADING.md#fees.
   */
  LIFI_INTEGRATOR: z.string().min(1, 'LIFI_INTEGRATOR is required for real swap quotes'),
  /** The other half of the race — see `OneInchSwapRouter` and docs/TRADING.md#provider. */
  ONEINCH_API_KEY: z.string().min(1, 'ONEINCH_API_KEY is required for real swap quotes'),

  /**
   * See docs/TRADING.md#fees. A bps integer, never a hardcoded literal scattered through
   * the codebase — every fee calculation reads this one value.
   */
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  /** Where the platform fee lands, collected atomically by the swap transaction itself —
   *  Kamby's backend never custodies it in between. See docs/TRADING.md#fees. */
  PLATFORM_FEE_RECIPIENT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'PLATFORM_FEE_RECIPIENT_ADDRESS must be a valid EVM address'),
  // The guaranteed-USDC-fee flow's "which token is the cash side" address used to be one
  // global USDC_CONTRACT_ADDRESS here — now per-chain (CHAIN_<SLUG>_USDC_ADDRESS above),
  // since Arbitrum's USDC contract is a different address than Base's. See
  // docs/TRADING.md#guaranteed-usdc-fees and getConfiguredChains() below.

  /**
   * Solana trading — see docs/TRADING.md#solana and docs/WALLET_SECURITY.md's Solana
   * section. Deliberately a *separate* conditionally-required block from CHAINS/
   * CHAIN_<SLUG>_* above, not folded into that system: Solana has no numeric EVM chainId
   * and no EvmChainDataProvider equivalent, so shoehorning it into the same shape would
   * make both harder to read. Gated by one flag so a deployment that hasn't set up Solana
   * yet isn't forced to populate any of the fields below.
   */
  SOLANA_ENABLED: z.coerce.boolean().default(false),
  /** Used for quote/balance reads and broadcasting — the launch (non-custodial) flow never
   *  signs anything server-side, see the flow's own doc comments. */
  SOLANA_RPC_URL: z.string().url('SOLANA_RPC_URL must be a valid URL').optional(),
  /** A USDC Associated Token Account owned by the treasury — NOT the treasury's raw wallet
   *  address. Jupiter's `feeAccount` must be a token account whose mint is part of the
   *  swap pair (here, USDC, since it's always the fixed input token); passing a plain
   *  wallet address here is a real, easy-to-make mistake this doc comment exists to
   *  prevent. See docs/TRADING.md#solana-fees. */
  SOLANA_TREASURY_USDC_ATA: z.string().min(1, 'SOLANA_TREASURY_USDC_ATA is required when SOLANA_ENABLED').optional(),
  /** See docs/TRADING.md#fees — matches the EVM side's 0.50% default, not the 0.75% first
   *  floated for this feature before the actual configured platform fee was checked. */
  SOLANA_JUPITER_PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  /** How much SOL a brand-new embedded wallet receives once, on creation, so "gasless-
   *  feeling" holds even though launch ships non-custodial (the wallet pays its own gas
   *  after this). Deliberately small — see SOLANA_TOPUP_FUNDING_SECRET_KEY below. */
  SOLANA_NEW_WALLET_TOPUP_SOL: z.coerce.number().positive().default(0.01),
  /**
   * A small, separately-funded operational keypair (base58-encoded secret key) that sends
   * exactly one fixed System Program transfer per newly-created embedded wallet — never
   * used for anything else. This is deliberately NOT a general-purpose signing key: unlike
   * a future gasless-relayer fee-payer (not built yet — see docs/WALLET_SECURITY.md), this
   * key only ever performs one instruction type against one recipient category (a wallet
   * this backend just created), so there's no arbitrary-transaction surface to validate.
   * Never logged — see the `redact` config in app.module.ts, which already anticipates a
   * `*.privateKey` path.
   */
  SOLANA_TOPUP_FUNDING_SECRET_KEY: z.string().min(1, 'SOLANA_TOPUP_FUNDING_SECRET_KEY is required when SOLANA_ENABLED').optional(),
});

const CHAIN_ENV_BLOCKS: Record<ChainSlug, { id: 'CHAIN_BASE_ID' | 'CHAIN_ARBITRUM_ID'; rpcUrl: 'CHAIN_BASE_RPC_URL' | 'CHAIN_ARBITRUM_RPC_URL'; usdcAddress: 'CHAIN_BASE_USDC_ADDRESS' | 'CHAIN_ARBITRUM_USDC_ADDRESS' }> = {
  base: { id: 'CHAIN_BASE_ID', rpcUrl: 'CHAIN_BASE_RPC_URL', usdcAddress: 'CHAIN_BASE_USDC_ADDRESS' },
  arbitrum: { id: 'CHAIN_ARBITRUM_ID', rpcUrl: 'CHAIN_ARBITRUM_RPC_URL', usdcAddress: 'CHAIN_ARBITRUM_USDC_ADDRESS' },
};

export const ValidatedEnvSchema = EnvSchema.superRefine((env, ctx) => {
  for (const rawSlug of env.CHAINS.split(',').map((s) => s.trim())) {
    if (!SUPPORTED_CHAIN_SLUGS.includes(rawSlug as ChainSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CHAINS'], message: `"${rawSlug}" is not a known chain slug (expected one of: ${SUPPORTED_CHAIN_SLUGS.join(', ')})` });
      continue;
    }
    const slug = rawSlug as ChainSlug;
    const block = CHAIN_ENV_BLOCKS[slug];
    if (env[block.id] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [block.id], message: `${block.id} is required because "${slug}" is listed in CHAINS` });
    if (env[block.rpcUrl] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [block.rpcUrl], message: `${block.rpcUrl} is required because "${slug}" is listed in CHAINS` });
    if (env[block.usdcAddress] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [block.usdcAddress], message: `${block.usdcAddress} is required because "${slug}" is listed in CHAINS` });
  }
  if (!SUPPORTED_CHAIN_SLUGS.includes(env.DEFAULT_CHAIN_SLUG as ChainSlug)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEFAULT_CHAIN_SLUG'], message: `"${env.DEFAULT_CHAIN_SLUG}" is not a known chain slug (expected one of: ${SUPPORTED_CHAIN_SLUGS.join(', ')})` });
  } else if (!env.CHAINS.split(',').map((s) => s.trim()).includes(env.DEFAULT_CHAIN_SLUG)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DEFAULT_CHAIN_SLUG'], message: `DEFAULT_CHAIN_SLUG ("${env.DEFAULT_CHAIN_SLUG}") must itself be listed in CHAINS ("${env.CHAINS}")` });
  }
}).superRefine((env, ctx) => {
  // Solana's own conditionally-required block — deliberately separate from the CHAINS loop
  // above, see SOLANA_ENABLED's doc comment.
  if (!env.SOLANA_ENABLED) return;
  if (env.SOLANA_RPC_URL === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_RPC_URL'], message: 'SOLANA_RPC_URL is required when SOLANA_ENABLED is true' });
  }
  if (env.SOLANA_TREASURY_USDC_ATA === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_TREASURY_USDC_ATA'], message: 'SOLANA_TREASURY_USDC_ATA is required when SOLANA_ENABLED is true' });
  }
  if (env.SOLANA_TOPUP_FUNDING_SECRET_KEY === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_TOPUP_FUNDING_SECRET_KEY'], message: 'SOLANA_TOPUP_FUNDING_SECRET_KEY is required when SOLANA_ENABLED is true' });
  }
});

export type Env = z.infer<typeof EnvSchema>;

export interface ConfiguredChain {
  slug: ChainSlug;
  chainId: number;
  rpcUrl: string;
  usdcAddress: string;
}

/**
 * The parsed, validated form of CHAINS + every CHAIN_<SLUG>_* block — every service that
 * needs "the list of chains this deployment runs on" (TransactionService's/LiFiSwapRouter's
 * per-chain client maps, QuoteService's per-chain USDC lookup) should build itself from this
 * once at construction, rather than re-parsing CHAINS or reading individual CHAIN_<SLUG>_*
 * keys by hand. Takes a plain key reader rather than a `ConfigService` directly, so a caller
 * just passes `(key) => config.get(key, { infer: true })` — no need to assemble a full `Env`
 * object first. Safe to call unconditionally once the app has booted (`ConfigModule.forRoot`
 * already ran `ValidatedEnvSchema` before any service constructor runs), so every field this
 * reads is guaranteed present and this never needs to re-check for `undefined`.
 */
export function getConfiguredChains(get: <K extends keyof Env>(key: K) => Env[K]): ConfiguredChain[] {
  return get('CHAINS')
    .split(',')
    .map((s) => s.trim() as ChainSlug)
    .map((slug) => {
      const block = CHAIN_ENV_BLOCKS[slug];
      return { slug, chainId: get(block.id)!, rpcUrl: get(block.rpcUrl)!, usdcAddress: get(block.usdcAddress)! };
    });
}

export interface SolanaConfig {
  rpcUrl: string;
  treasuryUsdcAta: string;
  jupiterPlatformFeeBps: number;
  newWalletTopupSol: number;
  topupFundingSecretKey: string;
}

/**
 * `null` when Solana isn't enabled on this deployment — every caller must handle that case
 * explicitly (there is no "default" Solana config the way `DEFAULT_CHAIN_SLUG` works for
 * EVM chains, since a deployment with Solana off shouldn't be able to accidentally reach
 * Solana-shaped code at all). Safe to call unconditionally once the app has booted, same
 * reasoning as `getConfiguredChains` — every field this reads when `SOLANA_ENABLED` is true
 * is guaranteed present by `ValidatedEnvSchema`'s second `superRefine`.
 */
export function getSolanaConfig(get: <K extends keyof Env>(key: K) => Env[K]): SolanaConfig | null {
  if (!get('SOLANA_ENABLED')) return null;
  return {
    rpcUrl: get('SOLANA_RPC_URL')!,
    treasuryUsdcAta: get('SOLANA_TREASURY_USDC_ATA')!,
    jupiterPlatformFeeBps: get('SOLANA_JUPITER_PLATFORM_FEE_BPS'),
    newWalletTopupSol: get('SOLANA_NEW_WALLET_TOPUP_SOL'),
    topupFundingSecretKey: get('SOLANA_TOPUP_FUNDING_SECRET_KEY')!,
  };
}
