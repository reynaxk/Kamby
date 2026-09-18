import type { ConfigService } from '@nestjs/config';
import { privateKeyToAccount } from 'viem/accounts';
import type { Env } from '../../config/env';
import { EvmRelayerWalletService } from './evm-relayer-wallet.service';

// A well-known, public test-only private key (Hardhat/Anvil's default account #0) — never a
// real, funded wallet. Same key already used in @kamby/chain-adapters/signature.test.ts.
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

function fakeConfig(overrides: Partial<Record<string, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'base,arbitrum',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: 8453,
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_RPC_URL_FALLBACK: undefined,
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    CHAIN_ARBITRUM_ID: 42161,
    CHAIN_ARBITRUM_RPC_URL: 'https://arb1.arbitrum.io/rpc',
    CHAIN_ARBITRUM_RPC_URL_FALLBACK: undefined,
    CHAIN_ARBITRUM_USDC_ADDRESS: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    EVM_GAS_RELAYER_ENABLED: true,
    EVM_GAS_RELAYER_PRIVATE_KEY: TEST_PRIVATE_KEY,
    EVM_GAS_RELAYER_CHAINS: 'base',
    EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BASE: 5,
    EVM_GAS_RELAYER_MAX_WEI_CEILING_BASE: 3_000_000_000_000_000,
    EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES: undefined,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('EvmRelayerWalletService', () => {
  it('resolves clients for a chain listed in EVM_GAS_RELAYER_CHAINS, with the right chain id and ceilings', () => {
    const service = new EvmRelayerWalletService(fakeConfig());
    const base = service.forChain('base');

    expect(base).not.toBeNull();
    expect(base?.chainId).toBe(8453);
    expect(base?.maxGasPriceGwei).toBe(5);
    expect(base?.maxWeiCeiling).toBe(3_000_000_000_000_000);
    expect(base?.account.address).toBe(TEST_ACCOUNT.address);
  });

  it('returns null for a chain that is configured for self-paid trading but not listed in EVM_GAS_RELAYER_CHAINS', () => {
    const service = new EvmRelayerWalletService(fakeConfig());

    expect(service.forChain('arbitrum')).toBeNull();
  });

  it('returns null for every chain, and a null relayerAddress, when the relayer is not enabled at all', () => {
    const service = new EvmRelayerWalletService(fakeConfig({ EVM_GAS_RELAYER_ENABLED: false }));

    expect(service.forChain('base')).toBeNull();
    expect(service.relayerAddress).toBeNull();
  });

  it('relayerAddress resolves to the real address derived from EVM_GAS_RELAYER_PRIVATE_KEY', () => {
    const service = new EvmRelayerWalletService(fakeConfig());

    expect(service.relayerAddress).toBe(TEST_ACCOUNT.address);
  });

  it('exposes testWalletAddresses as null (no restriction) when EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES is unset', () => {
    const service = new EvmRelayerWalletService(fakeConfig());

    expect(service.testWalletAddresses).toBeNull();
  });

  it('exposes testWalletAddresses as a parsed Set when configured, independent of chain wiring', () => {
    const service = new EvmRelayerWalletService(fakeConfig({ EVM_GAS_RELAYER_TEST_WALLET_ADDRESSES: '0xAAA,0xBBB' }));

    expect(service.testWalletAddresses).toEqual(new Set(['0xAAA', '0xBBB']));
  });

  it('reuses the exact same account address across every relayer-covered chain — one EVM key, unlike Solana, produces the same address everywhere', () => {
    const service = new EvmRelayerWalletService(
      fakeConfig({
        EVM_GAS_RELAYER_CHAINS: 'base,arbitrum',
        EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_ARBITRUM: 2,
        EVM_GAS_RELAYER_MAX_WEI_CEILING_ARBITRUM: 1_000_000_000_000_000,
      }),
    );

    expect(service.forChain('base')?.account.address).toBe(TEST_ACCOUNT.address);
    expect(service.forChain('arbitrum')?.account.address).toBe(TEST_ACCOUNT.address);
  });
});
