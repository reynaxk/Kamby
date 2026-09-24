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
  /** Optional second RPC endpoint — see docs/TRADING.md#rpc-failover. Genuinely optional
   *  even when this chain is listed in CHAINS (unlike CHAIN_BASE_RPC_URL itself): running
   *  without a fallback is a real, valid choice, just one with no protection against the
   *  primary provider's own outages/quota exhaustion — QuickNode's Base RPC has already
   *  exhausted its daily quota once in production with nothing to fall back to. */
  CHAIN_BASE_RPC_URL_FALLBACK: z.string().url('CHAIN_BASE_RPC_URL_FALLBACK must be a valid URL').optional(),
  /** This chain's USDC contract — see USDC_CONTRACT_ADDRESS's old doc comment (removed
   *  below in favor of this, per-chain, version): the one token the guaranteed-USDC-fee
   *  flow treats as "the cash side" on this specific chain. Must name the same token as
   *  apps/workers' matching CHAIN_<SLUG>_USDC_ADDRESS. */
  CHAIN_BASE_USDC_ADDRESS: z.string().regex(EVM_ADDRESS_REGEX, 'CHAIN_BASE_USDC_ADDRESS must be a valid EVM address').optional(),

  CHAIN_ARBITRUM_ID: z.coerce.number().int().positive().optional(),
  CHAIN_ARBITRUM_RPC_URL: z.string().url('CHAIN_ARBITRUM_RPC_URL must be a valid URL').optional(),
  /** See CHAIN_BASE_RPC_URL_FALLBACK's doc comment — same deal, per chain. */
  CHAIN_ARBITRUM_RPC_URL_FALLBACK: z.string().url('CHAIN_ARBITRUM_RPC_URL_FALLBACK must be a valid URL').optional(),
  CHAIN_ARBITRUM_USDC_ADDRESS: z
    .string()
    .regex(EVM_ADDRESS_REGEX, 'CHAIN_ARBITRUM_USDC_ADDRESS must be a valid EVM address')
    .optional(),

  CHAIN_BNB_ID: z.coerce.number().int().positive().optional(),
  CHAIN_BNB_RPC_URL: z.string().url('CHAIN_BNB_RPC_URL must be a valid URL').optional(),
  /** See CHAIN_BASE_RPC_URL_FALLBACK's doc comment — same deal, per chain. */
  CHAIN_BNB_RPC_URL_FALLBACK: z.string().url('CHAIN_BNB_RPC_URL_FALLBACK must be a valid URL').optional(),
  CHAIN_BNB_USDC_ADDRESS: z.string().regex(EVM_ADDRESS_REGEX, 'CHAIN_BNB_USDC_ADDRESS must be a valid EVM address').optional(),

  CHAIN_ETHEREUM_ID: z.coerce.number().int().positive().optional(),
  CHAIN_ETHEREUM_RPC_URL: z.string().url('CHAIN_ETHEREUM_RPC_URL must be a valid URL').optional(),
  /** See CHAIN_BASE_RPC_URL_FALLBACK's doc comment — same deal, per chain. */
  CHAIN_ETHEREUM_RPC_URL_FALLBACK: z.string().url('CHAIN_ETHEREUM_RPC_URL_FALLBACK must be a valid URL').optional(),
  CHAIN_ETHEREUM_USDC_ADDRESS: z
    .string()
    .regex(EVM_ADDRESS_REGEX, 'CHAIN_ETHEREUM_USDC_ADDRESS must be a valid EVM address')
    .optional(),

  /**
   * See docs/TRADING.md#provider. KyberSwap's Aggregator API needs no API key — only an
   * `X-Client-Id` header (a plain identifying string, not a secret) for rate-limit
   * prioritization, per KyberSwap's own docs. Defaulted, not required: unlike the LI.FI/
   * 1inch keys this replaced, a missing value here doesn't mean quotes are silently
   * degraded, since KyberSwap's docs confirm an absent/default client id just falls back
   * to a stricter (but still real) rate limit, not a rejected request.
   */
  KYBERSWAP_CLIENT_ID: z.string().min(1).default('kamby'),

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
  /** Optional second Solana RPC endpoint — see docs/TRADING.md#rpc-failover and
   *  apps/api/src/chain/solana-connection-pool.ts. Unlike the EVM side (viem ships its own
   *  `fallback()` transport), @solana/web3.js's Connection has no built-in multi-endpoint
   *  failover, so this is consumed by a hand-rolled circuit-breaker pool instead of a
   *  library feature. Genuinely optional — running Solana without a fallback RPC is valid,
   *  just unprotected against the primary's own outages. */
  SOLANA_RPC_URL_FALLBACK: z.string().url('SOLANA_RPC_URL_FALLBACK must be a valid URL').optional(),
  /** A USDC Associated Token Account owned by the treasury — NOT the treasury's raw wallet
   *  address. Jupiter's `feeAccount` must be a token account whose mint is part of the
   *  swap pair (here, USDC, since it's always the fixed input token); passing a plain
   *  wallet address here is a real, easy-to-make mistake this doc comment exists to
   *  prevent. See docs/TRADING.md#solana-fees. */
  SOLANA_TREASURY_USDC_ATA: z.string().min(1, 'SOLANA_TREASURY_USDC_ATA is required when SOLANA_ENABLED').optional(),
  /** Required by Jupiter even on its free tier (1 req/sec) — see JupiterQuoteService's own
   *  doc comment for why this exists (their old keyless domain stopped resolving in
   *  production on 2026-09-12). Get one at https://portal.jup.ag. */
  SOLANA_JUPITER_API_KEY: z.string().min(1, 'SOLANA_JUPITER_API_KEY is required when SOLANA_ENABLED').optional(),
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
  /**
   * Declares intent, checked in the third `superRefine` below — does NOT itself gate
   * whether `GasRelayerService` activates at runtime (that's still purely "is
   * SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY present," unchanged — see this class's own
   * getters). This flag exists only so a deployment that means to turn sponsorship on but
   * forgets one of the two fields below fails loudly at boot, the same way every other
   * *_ENABLED flag here already does, rather than silently staying inert the way "just
   * leave the secret unset" does today. Defaults false — `GasRelayerService` is wired into
   * `solana.module.ts` and both HTTP routes are live (see docs/GAS_RELAYER_PLAN.md) but
   * still safely inert on every real deployment until this is explicitly turned on and
   * funded.
   */
  SOLANA_GAS_RELAYER_ENABLED: z.coerce.boolean().default(false),
  /**
   * Only takes effect once `GasRelayerService` is actually constructed with a real secret
   * here — see that file's own doc comment. Required when SOLANA_GAS_RELAYER_ENABLED is
   * true (third `superRefine` below); left schema-optional otherwise so a deployment that
   * hasn't turned sponsorship on isn't forced to provision a relayer keypair. Never logged
   * — see the `redact` config in app.module.ts.
   */
  SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY: z.string().min(1).optional(),
  /** ~one signature fee + one ATA-creation rent, with headroom — the hard ceiling
   *  `GasRelayerService` checks a simulated transaction's cost against before ever
   *  co-signing for real. See that file's own doc comment. Required when
   *  SOLANA_GAS_RELAYER_ENABLED is true, same reasoning as the secret key above. */
  SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING: z.coerce.number().int().positive().optional(),
  /**
   * Comma-separated Solana wallet addresses — when set, `SolanaQuoteService#createSponsoredQuote`
   * and `GasRelayerService#submitSponsoredTransaction` both refuse sponsorship for any wallet
   * not on this list, with the exact same rejection message the "not enabled at all" case
   * uses (never a distinguishable "you're just not on the allowlist" response, so this
   * can't be probed for). Genuinely optional and independent of `SOLANA_GAS_RELAYER_ENABLED`
   * — unset (the default) means no restriction, every wallet is eligible once the relayer
   * itself is otherwise configured. The intended real rollout: set this to your own test
   * wallet(s) for the first live production cycle (see docs/GAS_RELAYER_PLAN.md's own
   * "Remaining work" — the plan explicitly calls for gating to internal test accounts
   * before opening this to every user), then simply unset it once that cycle is validated.
   */
  SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES: z.string().optional(),

  /**
   * EVM gasless relayer — Piece 4 of docs/GAS_RELAYER_PLAN.md, the EVM analogue of the
   * SOLANA_GAS_RELAYER_* block above. Deliberately a separate conditionally-required block,
   * not folded into CHAINS/CHAIN_<SLUG>_* above: which chains self-paid trading supports
   * (CHAINS) and which of those the relayer covers (EVM_GAS_RELAYER_CHAINS) are
   * independent — a deployment can trade self-paid on three chains while sponsoring gas on
   * only one. Same decoupling discipline as Solana's flag: this does NOT itself gate
   * whether the relayer activates at runtime (that's still purely "is
   * EVM_GAS_RELAYER_PRIVATE_KEY present") — it exists only so an enabled-but-misconfigured
   * deploy fails loudly at boot rather than silently staying inert. See
   * docs/WALLET_SECURITY.md's EVM section for the trust model this activates: unlike
   * Solana's co-signing relayer, an EVM meta-tx relayer is the transaction's sole signer —
   * see EvmRelayerConsentService's own doc comment for how real-time user consent is
   * proven instead.
   */
  EVM_GAS_RELAYER_ENABLED: z.coerce.boolean().default(false),
  /** One key, reused across every chain in EVM_GAS_RELAYER_CHAINS — an EVM private key
   *  produces the same address on every EVM chain, unlike Solana's per-chain-by-necessity
   *  keypairs. Required when EVM_GAS_RELAYER_ENABLED is true (fourth `superRefine` below).
   *  Never logged — see the `redact` config in app.module.ts, which already anticipates a
   *  `*.privateKey` path. */
  EVM_GAS_RELAYER_PRIVATE_KEY: z.string().min(1).optional(),
  /** Comma-separated subset of CHAINS this deployment actually sponsors gas on (e.g.
   *  "base") — every slug named here must also be listed in CHAINS (a relayer can't
   *  sponsor a chain self-paid trading isn't even configured for) and must have its own
   *  EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_<SLUG>/EVM_GAS_RELAYER_MAX_WEI_CEILING_<SLUG> pair
   *  populated (checked in superRefine). Required (non-empty) when EVM_GAS_RELAYER_ENABLED
   *  is true. */
  EVM_GAS_RELAYER_CHAINS: z.string().optional(),
  /** Comma-separated EVM wallet addresses — see
   *  SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES's own doc comment above for the exact
   *  rollout intent (gate to internal test accounts first) and the non-distinguishable-
   *  rejection discipline this mirrors exactly. Genuinely optional and independent of
   *  EVM_GAS_RELAYER_ENABLED — unset means no restriction. */
  EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES: z.string().optional(),

  /** The pre-broadcast `eth_call` simulation's gas-price ceiling for this chain — the
   *  relayer refuses to broadcast at a price above this regardless of what the network is
   *  currently charging. See docs/GAS_RELAYER_PLAN.md's EVM section for why this has no
   *  single cross-chain default (Base/Arbitrum/BNB gas economics differ materially) and is
   *  deliberately left unset here rather than guessed — real values come from the Track 2
   *  adversarial pass's live data. Required when this slug is listed in
   *  EVM_GAS_RELAYER_CHAINS. */
  EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BASE: z.coerce.number().positive().optional(),
  /** The hard total-cost ceiling (gas units × gas price, in wei) a simulated relayed
   *  transaction must stay under before the relayer will ever broadcast it for real — the
   *  direct analogue of SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING. Required when this slug
   *  is listed in EVM_GAS_RELAYER_CHAINS. */
  EVM_GAS_RELAYER_MAX_WEI_CEILING_BASE: z.coerce.number().int().positive().optional(),
  EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ARBITRUM: z.coerce.number().positive().optional(),
  EVM_GAS_RELAYER_MAX_WEI_CEILING_ARBITRUM: z.coerce.number().int().positive().optional(),
  EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BNB: z.coerce.number().positive().optional(),
  EVM_GAS_RELAYER_MAX_WEI_CEILING_BNB: z.coerce.number().int().positive().optional(),
  EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ETHEREUM: z.coerce.number().positive().optional(),
  EVM_GAS_RELAYER_MAX_WEI_CEILING_ETHEREUM: z.coerce.number().int().positive().optional(),

  /**
   * Cloudflare R2 (S3-compatible object storage) for profile-picture uploads — see
   * docs/TRADER_INTELLIGENCE.md#realized-pnl and R2StorageService's own doc comment.
   * Deliberately all-optional at the schema level, same convention every other
   * required-when-actually-used credential in this file follows (see the SOLANA_* block
   * above) — a deployment that never calls the avatar-upload endpoint shouldn't be forced
   * to provision a bucket first. `R2StorageService` itself throws a clear, actionable
   * error the moment an upload is actually attempted without these configured, rather than
   * this schema blocking every other route at boot. Never logged — `*.secretAccessKey` is
   * in the `redact` config in app.module.ts.
   */
  R2_ENDPOINT: z.string().url('R2_ENDPOINT must be a valid URL, e.g. https://<account id>.r2.cloudflarestorage.com').optional(),
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_BUCKET_NAME: z.string().min(1).optional(),
  /** The public URL prefix uploaded files are served from — either R2's own public bucket
   *  URL or a custom domain fronting it, never derived/guessed from R2_ENDPOINT (a
   *  private, account-scoped API endpoint, not a public asset host). */
  R2_PUBLIC_BASE_URL: z.string().url('R2_PUBLIC_BASE_URL must be a valid URL').optional(),
});

const CHAIN_ENV_BLOCKS: Record<
  ChainSlug,
  {
    id: 'CHAIN_BASE_ID' | 'CHAIN_ARBITRUM_ID' | 'CHAIN_BNB_ID' | 'CHAIN_ETHEREUM_ID';
    rpcUrl: 'CHAIN_BASE_RPC_URL' | 'CHAIN_ARBITRUM_RPC_URL' | 'CHAIN_BNB_RPC_URL' | 'CHAIN_ETHEREUM_RPC_URL';
    rpcUrlFallback:
      | 'CHAIN_BASE_RPC_URL_FALLBACK'
      | 'CHAIN_ARBITRUM_RPC_URL_FALLBACK'
      | 'CHAIN_BNB_RPC_URL_FALLBACK'
      | 'CHAIN_ETHEREUM_RPC_URL_FALLBACK';
    usdcAddress: 'CHAIN_BASE_USDC_ADDRESS' | 'CHAIN_ARBITRUM_USDC_ADDRESS' | 'CHAIN_BNB_USDC_ADDRESS' | 'CHAIN_ETHEREUM_USDC_ADDRESS';
  }
> = {
  base: { id: 'CHAIN_BASE_ID', rpcUrl: 'CHAIN_BASE_RPC_URL', rpcUrlFallback: 'CHAIN_BASE_RPC_URL_FALLBACK', usdcAddress: 'CHAIN_BASE_USDC_ADDRESS' },
  arbitrum: { id: 'CHAIN_ARBITRUM_ID', rpcUrl: 'CHAIN_ARBITRUM_RPC_URL', rpcUrlFallback: 'CHAIN_ARBITRUM_RPC_URL_FALLBACK', usdcAddress: 'CHAIN_ARBITRUM_USDC_ADDRESS' },
  bnb: { id: 'CHAIN_BNB_ID', rpcUrl: 'CHAIN_BNB_RPC_URL', rpcUrlFallback: 'CHAIN_BNB_RPC_URL_FALLBACK', usdcAddress: 'CHAIN_BNB_USDC_ADDRESS' },
  ethereum: {
    id: 'CHAIN_ETHEREUM_ID',
    rpcUrl: 'CHAIN_ETHEREUM_RPC_URL',
    rpcUrlFallback: 'CHAIN_ETHEREUM_RPC_URL_FALLBACK',
    usdcAddress: 'CHAIN_ETHEREUM_USDC_ADDRESS',
  },
};

const EVM_GAS_RELAYER_CEILING_BLOCKS: Record<
  ChainSlug,
  {
    maxGasPriceGwei:
      | 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BASE'
      | 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ARBITRUM'
      | 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BNB'
      | 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ETHEREUM';
    maxWeiCeiling:
      | 'EVM_GAS_RELAYER_MAX_WEI_CEILING_BASE'
      | 'EVM_GAS_RELAYER_MAX_WEI_CEILING_ARBITRUM'
      | 'EVM_GAS_RELAYER_MAX_WEI_CEILING_BNB'
      | 'EVM_GAS_RELAYER_MAX_WEI_CEILING_ETHEREUM';
  }
> = {
  base: { maxGasPriceGwei: 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BASE', maxWeiCeiling: 'EVM_GAS_RELAYER_MAX_WEI_CEILING_BASE' },
  arbitrum: { maxGasPriceGwei: 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ARBITRUM', maxWeiCeiling: 'EVM_GAS_RELAYER_MAX_WEI_CEILING_ARBITRUM' },
  bnb: { maxGasPriceGwei: 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BNB', maxWeiCeiling: 'EVM_GAS_RELAYER_MAX_WEI_CEILING_BNB' },
  ethereum: { maxGasPriceGwei: 'EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ETHEREUM', maxWeiCeiling: 'EVM_GAS_RELAYER_MAX_WEI_CEILING_ETHEREUM' },
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
  if (env.SOLANA_JUPITER_API_KEY === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_JUPITER_API_KEY'], message: 'SOLANA_JUPITER_API_KEY is required when SOLANA_ENABLED is true' });
  }
}).superRefine((env, ctx) => {
  // The gas relayer's own conditionally-required block — deliberately separate from (not
  // nested inside) the Solana block above: this must still fire and report a clear error
  // even when SOLANA_ENABLED is false, since "sponsorship on, Solana itself off" is exactly
  // the nonsensical combination this exists to catch rather than silently no-op.
  if (!env.SOLANA_GAS_RELAYER_ENABLED) return;
  if (!env.SOLANA_ENABLED) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SOLANA_GAS_RELAYER_ENABLED'], message: 'SOLANA_GAS_RELAYER_ENABLED requires SOLANA_ENABLED to also be true' });
  }
  if (env.SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY'],
      message: 'SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY is required when SOLANA_GAS_RELAYER_ENABLED is true',
    });
  }
  if (env.SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING'],
      message: 'SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING is required when SOLANA_GAS_RELAYER_ENABLED is true',
    });
  }
}).superRefine((env, ctx) => {
  // The EVM gas relayer's own conditionally-required block — mirrors the Solana relayer
  // block above (deliberately separate, fires regardless of whether SOLANA_* is
  // configured on this deployment).
  if (!env.EVM_GAS_RELAYER_ENABLED) return;
  if (env.EVM_GAS_RELAYER_PRIVATE_KEY === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EVM_GAS_RELAYER_PRIVATE_KEY'], message: 'EVM_GAS_RELAYER_PRIVATE_KEY is required when EVM_GAS_RELAYER_ENABLED is true' });
  }
  const relayerChains = (env.EVM_GAS_RELAYER_CHAINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (relayerChains.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EVM_GAS_RELAYER_CHAINS'], message: 'EVM_GAS_RELAYER_CHAINS is required (non-empty) when EVM_GAS_RELAYER_ENABLED is true' });
  }
  const configuredChainSlugs = env.CHAINS.split(',').map((s) => s.trim());
  for (const rawSlug of relayerChains) {
    if (!SUPPORTED_CHAIN_SLUGS.includes(rawSlug as ChainSlug)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['EVM_GAS_RELAYER_CHAINS'], message: `"${rawSlug}" is not a known chain slug (expected one of: ${SUPPORTED_CHAIN_SLUGS.join(', ')})` });
      continue;
    }
    if (!configuredChainSlugs.includes(rawSlug)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EVM_GAS_RELAYER_CHAINS'],
        message: `"${rawSlug}" is listed in EVM_GAS_RELAYER_CHAINS but not in CHAINS — the relayer can't sponsor a chain self-paid trading isn't even configured for`,
      });
      continue;
    }
    const slug = rawSlug as ChainSlug;
    const block = EVM_GAS_RELAYER_CEILING_BLOCKS[slug];
    if (env[block.maxGasPriceGwei] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [block.maxGasPriceGwei], message: `${block.maxGasPriceGwei} is required because "${slug}" is listed in EVM_GAS_RELAYER_CHAINS` });
    }
    if (env[block.maxWeiCeiling] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [block.maxWeiCeiling], message: `${block.maxWeiCeiling} is required because "${slug}" is listed in EVM_GAS_RELAYER_CHAINS` });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

export interface ConfiguredChain {
  slug: ChainSlug;
  chainId: number;
  rpcUrl: string;
  /** `null` when no fallback is configured — see CHAIN_BASE_RPC_URL_FALLBACK's doc
   *  comment. Consumers pass this straight to `createEvmTransport` (@kamby/chain-adapters),
   *  which already treats `null`/`undefined` as "no fallback, use a single transport." */
  rpcUrlFallback: string | null;
  usdcAddress: string;
}

/**
 * The parsed, validated form of CHAINS + every CHAIN_<SLUG>_* block — every service that
 * needs "the list of chains this deployment runs on" (TransactionService's/KyberSwapRouter's
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
      return {
        slug,
        chainId: get(block.id)!,
        rpcUrl: get(block.rpcUrl)!,
        rpcUrlFallback: get(block.rpcUrlFallback) ?? null,
        usdcAddress: get(block.usdcAddress)!,
      };
    });
}

export interface SolanaConfig {
  rpcUrl: string;
  /** `null` when no fallback is configured — see SOLANA_RPC_URL_FALLBACK's doc comment. */
  rpcUrlFallback: string | null;
  treasuryUsdcAta: string;
  jupiterApiKey: string;
  jupiterPlatformFeeBps: number;
  newWalletTopupSol: number;
  topupFundingSecretKey: string;
  /** `null` unless `GasRelayerService` is actually configured with a real fee-payer secret
   *  — unlike every other field above, these are genuinely optional even when Solana itself
   *  is enabled. See docs/GAS_RELAYER_PLAN.md. */
  gasRelayerFeePayerSecretKey: string | null;
  gasRelayerMaxLamportsCeiling: number | null;
  /** `null` means no restriction (every wallet eligible) — see
   *  SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES's own doc comment above for the intended
   *  rollout this exists for. */
  gasRelayerTestWalletAddresses: ReadonlySet<string> | null;
}

function parseTestWalletAllowlist(raw: string | undefined): ReadonlySet<string> | null {
  if (raw === undefined) return null;
  const addresses = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(addresses);
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
    rpcUrlFallback: get('SOLANA_RPC_URL_FALLBACK') ?? null,
    treasuryUsdcAta: get('SOLANA_TREASURY_USDC_ATA')!,
    jupiterApiKey: get('SOLANA_JUPITER_API_KEY')!,
    jupiterPlatformFeeBps: get('SOLANA_JUPITER_PLATFORM_FEE_BPS'),
    newWalletTopupSol: get('SOLANA_NEW_WALLET_TOPUP_SOL'),
    topupFundingSecretKey: get('SOLANA_TOPUP_FUNDING_SECRET_KEY')!,
    gasRelayerFeePayerSecretKey: get('SOLANA_GAS_RELAYER_FEE_PAYER_SECRET_KEY') ?? null,
    gasRelayerMaxLamportsCeiling: get('SOLANA_GAS_RELAYER_MAX_LAMPORTS_CEILING') ?? null,
    gasRelayerTestWalletAddresses: parseTestWalletAllowlist(get('SOLANA_GAS_RELAYER_TEST_WALLET_ADDRESSES')),
  };
}

export interface ConfiguredEvmRelayerChain {
  slug: ChainSlug;
  maxGasPriceGwei: number;
  maxWeiCeiling: number;
}

export interface EvmGasRelayerConfig {
  privateKey: string;
  /** Only the chains actually listed in EVM_GAS_RELAYER_CHAINS — a strict subset of
   *  getConfiguredChains()'s result, never assume every configured EVM chain is
   *  relayer-covered. */
  chains: ConfiguredEvmRelayerChain[];
  /** `null` means no restriction (every wallet eligible) — see
   *  EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES's own doc comment above. */
  testWalletAddresses: ReadonlySet<string> | null;
}

/**
 * `null` when the EVM relayer isn't enabled on this deployment — every caller must handle
 * that case explicitly, same reasoning as `getSolanaConfig`. Safe to call unconditionally
 * once the app has booted: every field this reads when `EVM_GAS_RELAYER_ENABLED` is true is
 * guaranteed present by `ValidatedEnvSchema`'s fourth `superRefine`.
 */
export function getEvmGasRelayerConfig(get: <K extends keyof Env>(key: K) => Env[K]): EvmGasRelayerConfig | null {
  if (!get('EVM_GAS_RELAYER_ENABLED')) return null;
  const chains = (get('EVM_GAS_RELAYER_CHAINS') ?? '')
    .split(',')
    .map((s) => s.trim() as ChainSlug)
    .filter((s) => s.length > 0)
    .map((slug) => {
      const block = EVM_GAS_RELAYER_CEILING_BLOCKS[slug];
      return {
        slug,
        maxGasPriceGwei: get(block.maxGasPriceGwei)!,
        maxWeiCeiling: get(block.maxWeiCeiling)!,
      };
    });
  return {
    privateKey: get('EVM_GAS_RELAYER_PRIVATE_KEY')!,
    chains,
    testWalletAddresses: parseTestWalletAllowlist(get('EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES')),
  };
}
