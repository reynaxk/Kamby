import type { PinoLogger } from 'nestjs-pino';
import { EvmGasRelayerService } from './evm-gas-relayer.service';
import { EvmRelayerNonceManagerService } from './evm-relayer-nonce-manager.service';
import type { EvmRelayerChainClients, EvmRelayerWalletService } from './evm-relayer-wallet.service';

const RELAYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const TO = '0x2222222222222222222222222222222222222222' as const;
const DATA = '0xabcdef' as const;

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeChainClients(overrides: Partial<EvmRelayerChainClients> = {}): EvmRelayerChainClients {
  return {
    chainId: 8453,
    chain: { id: 8453, name: 'base', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://mainnet.base.org'] } } },
    maxGasPriceGwei: 5,
    maxWeiCeiling: 3_000_000_000_000_000,
    publicClient: {
      call: jest.fn().mockResolvedValue({ data: '0x' }),
      estimateGas: jest.fn().mockResolvedValue(150_000n),
      estimateFeesPerGas: jest.fn().mockResolvedValue({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n }),
      getTransactionCount: jest.fn().mockResolvedValue(7),
    } as never,
    walletClient: {
      sendTransaction: jest.fn().mockResolvedValue('0xdeadbeef'),
    } as never,
    account: { address: RELAYER_ADDRESS } as never,
    ...overrides,
  };
}

function fakeWallet(clients: EvmRelayerChainClients | null): EvmRelayerWalletService {
  return { forChain: jest.fn().mockReturnValue(clients) } as unknown as EvmRelayerWalletService;
}

describe('EvmGasRelayerService', () => {
  describe('isConfigured', () => {
    it('is true when the wallet service has clients for this chain', () => {
      const service = new EvmGasRelayerService(fakeWallet(fakeChainClients()), new EvmRelayerNonceManagerService(), fakeLogger());
      expect(service.isConfigured('base')).toBe(true);
    });

    it('is false when the wallet service has no clients for this chain', () => {
      const service = new EvmGasRelayerService(fakeWallet(null), new EvmRelayerNonceManagerService(), fakeLogger());
      expect(service.isConfigured('base')).toBe(false);
    });
  });

  describe('simulate', () => {
    it('simulates as the relayer account, not any user wallet, and returns the estimated gas on success', async () => {
      const clients = fakeChainClients();
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      const result = await service.simulate('base', { to: TO, data: DATA, value: 0n });

      expect(result).toEqual({ ok: true, gasUnits: 150_000n });
      expect(clients.publicClient.call).toHaveBeenCalledWith(expect.objectContaining({ account: clients.account, to: TO, data: DATA, value: 0n }));
      expect(clients.publicClient.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ account: clients.account, to: TO, data: DATA, value: 0n }));
    });

    it('returns ok:false with the real error message, never throws, when the dry run would revert', async () => {
      const clients = fakeChainClients({ publicClient: { call: jest.fn().mockRejectedValue(new Error('execution reverted: insufficient output amount')), estimateGas: jest.fn() } as never });
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      const result = await service.simulate('base', { to: TO, data: DATA, value: 0n });

      expect(result).toEqual({ ok: false, reason: expect.stringContaining('insufficient output amount') });
    });

    it('never calls estimateGas after a failed call — no point pricing a transaction that would revert', async () => {
      const estimateGas = jest.fn();
      const clients = fakeChainClients({ publicClient: { call: jest.fn().mockRejectedValue(new Error('reverted')), estimateGas } as never });
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      await service.simulate('base', { to: TO, data: DATA, value: 0n });

      expect(estimateGas).not.toHaveBeenCalled();
    });

    it('throws a clear error for a chain the relayer is not configured for — a caller bug, not a runtime rejection', async () => {
      const service = new EvmGasRelayerService(fakeWallet(null), new EvmRelayerNonceManagerService(), fakeLogger());

      await expect(service.simulate('base', { to: TO, data: DATA, value: 0n })).rejects.toThrow(/not configured for chain "base"/);
    });
  });

  describe('checkGasCeiling', () => {
    it('accepts a cost comfortably within both the price and total-cost ceilings', async () => {
      const clients = fakeChainClients(); // 1 gwei maxFeePerGas, 5 gwei ceiling
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      const result = await service.checkGasCeiling('base', 150_000n);

      expect(result).toEqual({ ok: true, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n, totalCostWei: 150_000_000_000_000n });
    });

    it('rejects when the estimated maxFeePerGas exceeds the configured per-chain price ceiling', async () => {
      const clients = fakeChainClients({
        maxGasPriceGwei: 1, // 1 gwei ceiling
        publicClient: { estimateFeesPerGas: jest.fn().mockResolvedValue({ maxFeePerGas: 5_000_000_000n, maxPriorityFeePerGas: 100_000_000n }) } as never,
      });
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      const result = await service.checkGasCeiling('base', 150_000n);

      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toMatch(/exceeds the configured ceiling/);
    });

    it('rejects on total cost even when the per-unit price is under the price ceiling — an unusually large gas estimate is caught independently', async () => {
      const clients = fakeChainClients({ maxWeiCeiling: 1_000_000_000_000 }); // far below 150_000 * 1e9
      const service = new EvmGasRelayerService(fakeWallet(clients), new EvmRelayerNonceManagerService(), fakeLogger());

      const result = await service.checkGasCeiling('base', 150_000n);

      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toMatch(/total cost/);
    });
  });

  describe('broadcast', () => {
    it('reads the pending nonce, signs, and submits with the exact fees and gas the caller already priced', async () => {
      const clients = fakeChainClients();
      const nonceManager = new EvmRelayerNonceManagerService();
      const service = new EvmGasRelayerService(fakeWallet(clients), nonceManager, fakeLogger());

      const result = await service.broadcast(
        'base',
        { to: TO, data: DATA, value: 0n },
        { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n },
        150_000n,
      );

      expect(result).toEqual({ txHash: '0xdeadbeef', nonce: 7 });
      expect(clients.publicClient.getTransactionCount).toHaveBeenCalledWith({ address: RELAYER_ADDRESS, blockTag: 'pending' });
      expect(clients.walletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          account: clients.account,
          chain: clients.chain,
          to: TO,
          data: DATA,
          value: 0n,
          nonce: 7,
          gas: 150_000n,
          maxFeePerGas: 1_000_000_000n,
          maxPriorityFeePerGas: 100_000_000n,
        }),
      );
    });

    it('serializes two concurrent broadcasts on the same chain through the nonce manager — never reads the same pending nonce twice', async () => {
      let nextNonce = 7;
      const clients = fakeChainClients({
        publicClient: {
          getTransactionCount: jest.fn().mockImplementation(async () => nextNonce++),
        } as never,
      });
      const nonceManager = new EvmRelayerNonceManagerService();
      const service = new EvmGasRelayerService(fakeWallet(clients), nonceManager, fakeLogger());
      const fees = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n };

      const [first, second] = await Promise.all([
        service.broadcast('base', { to: TO, data: DATA, value: 0n }, fees, 150_000n),
        service.broadcast('base', { to: TO, data: DATA, value: 0n }, fees, 150_000n),
      ]);

      expect([first.nonce, second.nonce].sort()).toEqual([7, 8]);
    });
  });
});
