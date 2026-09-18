import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@kamby/db';
import { buildRelayedSwapTypedData, toWireTypedData, type TradeQuoteDto } from '@kamby/domain';
import type { PinoLogger } from 'nestjs-pino';
import { privateKeyToAccount } from 'viem/accounts';
import type { Env } from '../../config/env';
import type { EvmGasRelayerService, EvmRelayerBroadcastResult, EvmRelayerCeilingCheckResult, EvmRelayerSimulationResult } from './evm-gas-relayer.service';
import { EvmGasRelayerQuoteService } from './evm-gas-relayer-quote.service';
import type { EvmRelayerWalletService } from './evm-relayer-wallet.service';

jest.mock('@kamby/db', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    Prisma: actual.Prisma,
    prisma: {
      tradeQuote: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      tradeTransaction: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(),
    },
  };
});

const mockedPrisma = jest.mocked(prisma, { shallow: true });

// Well-known, public test-only private keys (Hardhat/Anvil's default accounts #0 and #1) —
// never real, funded wallets. Used to produce a real EIP-712 signature these tests verify
// for real, not a mocked boolean.
const RELAYER_ACCOUNT = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const USER_ACCOUNT = privateKeyToAccount('0x0b222ad9e3cd55de14479ab73376d544b6c5a35ac0a471c4fb8a707b7b0a2038');

const CHAIN_ID = 8453;
const TO = '0x2222222222222222222222222222222222222222';
const DATA = '0xabcdef';
const VALUE = '1000000000000000';

function fakeLogger(): PinoLogger {
  return { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as PinoLogger;
}

function fakeConfig(): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: CHAIN_ID,
    CHAIN_BASE_RPC_URL: 'https://mainnet.base.org',
    CHAIN_BASE_USDC_ADDRESS: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function fakeWallet(overrides: Partial<EvmRelayerWalletService> = {}): EvmRelayerWalletService {
  return { relayerAddress: RELAYER_ACCOUNT.address, testWalletAddresses: null, ...overrides } as unknown as EvmRelayerWalletService;
}

function fakeRelayer(overrides: Partial<Record<keyof EvmGasRelayerService, unknown>> = {}): EvmGasRelayerService {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    simulate: jest.fn().mockResolvedValue({ ok: true, gasUnits: 150_000n } satisfies EvmRelayerSimulationResult),
    checkGasCeiling: jest.fn().mockResolvedValue({
      ok: true,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
      totalCostWei: 150_000_000_000_000n,
    } satisfies EvmRelayerCeilingCheckResult),
    broadcast: jest.fn().mockResolvedValue({ txHash: '0xdeadbeef', nonce: 7 } satisfies EvmRelayerBroadcastResult),
    ...overrides,
  } as unknown as EvmGasRelayerService;
}

function fakeQuoteRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'quote-1',
    userId: 'user-1',
    walletAddress: USER_ACCOUNT.address,
    chainId: CHAIN_ID,
    side: 'BUY',
    tokenMarketId: 'market-1',
    inputToken: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    outputToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    inputAmount: '1000000',
    expectedOutputAmount: '2000000',
    platformFeeAmount: '5000',
    unsignedTx: { to: TO, data: DATA, value: VALUE, gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
    sponsorshipRequested: true,
    relayerStatus: 'PENDING_CONSENT',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

async function realConsentSignature(quote: ReturnType<typeof fakeQuoteRow>): Promise<string> {
  const typedData = buildRelayedSwapTypedData({
    quoteId: quote.id,
    walletAddress: quote.walletAddress,
    chainId: quote.chainId,
    relayerAddress: RELAYER_ACCOUNT.address,
    unsignedTx: quote.unsignedTx,
    expiresAt: quote.expiresAt,
  });
  return USER_ACCOUNT.signTypedData(typedData as never);
}

function fakeCreatedTransactionRow(quote: ReturnType<typeof fakeQuoteRow>, txHash: string) {
  return {
    id: 'tx-1',
    userId: quote.userId,
    walletAddress: quote.walletAddress.toLowerCase(),
    quoteId: quote.id,
    chainId: quote.chainId,
    txHash,
    tokenMarketId: quote.tokenMarketId,
    side: quote.side,
    inputToken: quote.inputToken,
    outputToken: quote.outputToken,
    inputAmount: quote.inputAmount,
    expectedOutputAmount: quote.expectedOutputAmount,
    platformFeeAmount: quote.platformFeeAmount,
    status: 'PENDING',
    failureReason: null,
    sponsoredByRelayer: true,
    relayerFeePayer: RELAYER_ACCOUNT.address,
    submittedAt: new Date(),
    confirmedAt: null,
    feeTxHash: null,
    feeStatus: null,
    feeFailureReason: null,
    feeSubmittedAt: null,
    feeConfirmedAt: null,
    tokenMarket: {
      token: { contractAddress: quote.inputToken, symbol: 'FOO', decimals: 18 },
      quoteToken: { contractAddress: quote.outputToken, symbol: 'BAR', decimals: 18 },
    },
    quote: { feeUnsignedTx: null },
  };
}

describe('EvmGasRelayerQuoteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('attachSponsorshipIfEligible', () => {
    function fakeQuoteDto(): TradeQuoteDto {
      return {
        id: 'quote-1',
        chainId: CHAIN_ID,
        side: 'BUY',
        token: { address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'FOO', decimals: 18 },
        quoteToken: { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'BAR', decimals: 18 },
        inputAmount: '1000000',
        expectedOutputAmount: '2000000',
        minOutputAmount: '1900000',
        inputAmountFormatted: '1.0',
        expectedOutputAmountFormatted: '2.0',
        minOutputAmountFormatted: '1.9',
        priceUsd: 1,
        priceImpactBps: 10,
        priceImpactLevel: 'normal',
        slippageBps: 50,
        platformFeeBps: 100,
        platformFeeAmount: '1000',
        platformFeeAmountFormatted: '0.001',
        provider: 'kyberswap',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        unsignedTx: { to: TO, data: DATA, value: VALUE, gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null },
        feeUnsignedTx: null,
        safetyNote: 'No known issues detected by available checks.',
        requiresApproval: false,
        approvalSpender: null,
        sponsorshipAvailable: false,
      };
    }

    it('reports sponsorshipAvailable but attaches no consentTypedData or DB write when eligible but not requested', async () => {
      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());
      const dto = fakeQuoteDto();

      const result = await service.attachSponsorshipIfEligible(dto, { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: false });

      expect(result).toEqual({ ...dto, sponsorshipAvailable: true });
      expect(mockedPrisma.tradeQuote.update).not.toHaveBeenCalled();
    });

    it('reports sponsorshipAvailable: false, indistinguishably from "not requested", when the relayer is not configured for this chain', async () => {
      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer({ isConfigured: jest.fn().mockReturnValue(false) }), fakeConfig(), fakeLogger());
      const dto = fakeQuoteDto();

      const result = await service.attachSponsorshipIfEligible(dto, { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: true });

      expect(result.sponsorshipAvailable).toBe(false);
      expect(result.consentTypedData).toBeUndefined();
      expect(mockedPrisma.tradeQuote.update).not.toHaveBeenCalled();
    });

    it('reports sponsorshipAvailable: false when a rollout allowlist is set and this wallet is not on it', async () => {
      const service = new EvmGasRelayerQuoteService(
        fakeWallet({ testWalletAddresses: new Set(['0xsomeoneelse']) }),
        fakeRelayer(),
        fakeConfig(),
        fakeLogger(),
      );
      const dto = fakeQuoteDto();

      const result = await service.attachSponsorshipIfEligible(dto, { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: true });

      expect(result.sponsorshipAvailable).toBe(false);
      expect(result.consentTypedData).toBeUndefined();
    });

    it('computes sponsorshipAvailable regardless of sponsorshipRequested — even a bare, un-requested quote learns whether gasless would work', async () => {
      const eligible = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());
      const ineligible = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer({ isConfigured: jest.fn().mockReturnValue(false) }), fakeConfig(), fakeLogger());

      const eligibleResult = await eligible.attachSponsorshipIfEligible(fakeQuoteDto(), { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: false });
      const ineligibleResult = await ineligible.attachSponsorshipIfEligible(fakeQuoteDto(), { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: false });

      expect(eligibleResult.sponsorshipAvailable).toBe(true);
      expect(ineligibleResult.sponsorshipAvailable).toBe(false);
      expect(mockedPrisma.tradeQuote.update).not.toHaveBeenCalled();
    });

    it('attaches consentTypedData and persists the consent-tracking fields when eligible', async () => {
      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());
      const dto = fakeQuoteDto();

      const result = await service.attachSponsorshipIfEligible(dto, { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: true });

      expect(result.consentTypedData).toEqual(
        toWireTypedData(
          buildRelayedSwapTypedData({
            quoteId: dto.id,
            walletAddress: USER_ACCOUNT.address,
            chainId: CHAIN_ID,
            relayerAddress: RELAYER_ACCOUNT.address,
            unsignedTx: dto.unsignedTx,
            expiresAt: new Date(dto.expiresAt),
          }),
        ),
      );
      expect(mockedPrisma.tradeQuote.update).toHaveBeenCalledWith({
        where: { id: dto.id },
        data: { sponsorshipRequested: true, relayerStatus: 'PENDING_CONSENT' },
      });
    });

    it('allows a wallet that is on the configured allowlist', async () => {
      const service = new EvmGasRelayerQuoteService(
        fakeWallet({ testWalletAddresses: new Set([USER_ACCOUNT.address]) }),
        fakeRelayer(),
        fakeConfig(),
        fakeLogger(),
      );
      const dto = fakeQuoteDto();

      const result = await service.attachSponsorshipIfEligible(dto, { chainId: CHAIN_ID, walletAddress: USER_ACCOUNT.address, sponsorshipRequested: true });

      expect(result.consentTypedData).toBeDefined();
    });
  });

  describe('relay', () => {
    it('verifies a real EIP-712 signature end-to-end, simulates, checks the ceiling, broadcasts, and persists a sponsored TradeTransaction', async () => {
      const quote = fakeQuoteRow();
      const signature = await realConsentSignature(quote);
      const createdRow = fakeCreatedTransactionRow(quote, '0xdeadbeef');
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      (mockedPrisma.tradeQuote.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      mockedPrisma.$transaction.mockResolvedValue([createdRow, {}]);
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const result = await service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature });

      expect(result.sponsoredByRelayer).toBe(true);
      expect(result.relayerFeePayer).toBe(RELAYER_ACCOUNT.address);
      expect(result.txHash).toBe('0xdeadbeef');
      expect(relayer.simulate).toHaveBeenCalledWith('base', { to: TO, data: DATA, value: BigInt(VALUE) });
      expect(relayer.checkGasCeiling).toHaveBeenCalledWith('base', 150_000n);
      expect(relayer.broadcast).toHaveBeenCalledWith(
        'base',
        { to: TO, data: DATA, value: BigInt(VALUE) },
        { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n },
        150_000n,
      );
      expect(mockedPrisma.tradeQuote.updateMany).toHaveBeenCalledWith({
        where: { id: quote.id, relayerStatus: 'PENDING_CONSENT' },
        data: { relayerStatus: 'CONSENT_RECEIVED', relayerConsentSignature: signature },
      });
    });

    it('is idempotent — a retry against an already-broadcast quote returns the existing transaction and never re-simulates or re-broadcasts', async () => {
      const quote = fakeQuoteRow();
      const existing = fakeCreatedTransactionRow(quote, '0xalreadydone');
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(existing as never);
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const result = await service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' });

      expect(result.txHash).toBe('0xalreadydone');
      expect(relayer.simulate).not.toHaveBeenCalled();
      expect(mockedPrisma.tradeQuote.findUnique).not.toHaveBeenCalled();
    });

    it('rejects when an existing transaction for this quote belongs to a different user', async () => {
      const quote = fakeQuoteRow();
      const existing = fakeCreatedTransactionRow(quote, '0xalreadydone');
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue({ ...existing, userId: 'someone-else' } as never);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects with NotFoundException when the quote does not exist', async () => {
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(null);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: 'user-1', walletAddress: USER_ACCOUNT.address, quoteId: 'missing', signature: '0xanything' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when the quote belongs to a different user', async () => {
      const quote = fakeQuoteRow({ userId: 'someone-else' });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: 'user-1', walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the quote was created for a different wallet', async () => {
      const quote = fakeQuoteRow();
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: '0x9999999999999999999999999999999999999a', quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a quote that was never created as sponsored', async () => {
      const quote = fakeQuoteRow({ sponsorshipRequested: false, relayerStatus: null });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects a quote whose sponsorship has already moved past PENDING_CONSENT, without touching the relayer', async () => {
      const quote = fakeQuoteRow({ relayerStatus: 'FAILED' });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(/already failed/);
      expect(relayer.simulate).not.toHaveBeenCalled();
    });

    it('rejects and marks the quote FAILED when it has already expired — never broadcasts', async () => {
      const quote = fakeQuoteRow({ expiresAt: new Date(Date.now() - 1000) });
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: '0xanything' }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(mockedPrisma.tradeQuote.update).toHaveBeenCalledWith({ where: { id: quote.id }, data: { relayerStatus: 'FAILED', relayerFailureReason: expect.any(String) } });
      expect(relayer.simulate).not.toHaveBeenCalled();
    });

    it('rejects a tampered message with a real cryptographic check — never broadcasts on a signature that does not verify', async () => {
      const quote = fakeQuoteRow();
      // Sign the correct typed data, then submit it against a row whose amount was
      // (hypothetically) since mutated — the same real verifyEvmTypedDataSignature check
      // production uses, not a mocked boolean.
      const validSignature = await realConsentSignature(quote);
      const mutatedQuote = { ...quote, unsignedTx: { ...quote.unsignedTx, value: '999999999999999999' } };
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(mutatedQuote as never);
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: validSignature }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockedPrisma.tradeQuote.update).toHaveBeenCalledWith({
        where: { id: quote.id },
        data: { relayerStatus: 'FAILED', relayerFailureReason: expect.any(String) },
      });
      expect(relayer.simulate).not.toHaveBeenCalled();
      expect(mockedPrisma.tradeQuote.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a signature from the wrong signer', async () => {
      const quote = fakeQuoteRow();
      const typedData = buildRelayedSwapTypedData({
        quoteId: quote.id,
        walletAddress: quote.walletAddress,
        chainId: quote.chainId,
        relayerAddress: RELAYER_ACCOUNT.address,
        unsignedTx: quote.unsignedTx,
        expiresAt: quote.expiresAt,
      });
      const wrongSignerSignature = await RELAYER_ACCOUNT.signTypedData(typedData as never); // relayer signs instead of the user
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);

      const service = new EvmGasRelayerQuoteService(fakeWallet(), fakeRelayer(), fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature: wrongSignerSignature }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when a concurrent relay call already claimed this quote — never double-broadcasts', async () => {
      const quote = fakeQuoteRow();
      const signature = await realConsentSignature(quote);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      (mockedPrisma.tradeQuote.updateMany as jest.Mock).mockResolvedValue({ count: 0 }); // lost the claim race
      const relayer = fakeRelayer();

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature }),
      ).rejects.toThrow(UnprocessableEntityException);
      expect(relayer.simulate).not.toHaveBeenCalled();
      expect(relayer.broadcast).not.toHaveBeenCalled();
    });

    it('marks the quote FAILED and never broadcasts when pre-broadcast simulation would revert', async () => {
      const quote = fakeQuoteRow();
      const signature = await realConsentSignature(quote);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      (mockedPrisma.tradeQuote.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({ simulate: jest.fn().mockResolvedValue({ ok: false, reason: 'execution reverted' } satisfies EvmRelayerSimulationResult) });

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature }),
      ).rejects.toThrow(/execution reverted/);
      expect(relayer.broadcast).not.toHaveBeenCalled();
      expect(mockedPrisma.tradeQuote.update).toHaveBeenCalledWith({
        where: { id: quote.id },
        data: { relayerStatus: 'FAILED', relayerFailureReason: 'execution reverted' },
      });
    });

    it('marks the quote FAILED and never broadcasts when the gas ceiling would be exceeded', async () => {
      const quote = fakeQuoteRow();
      const signature = await realConsentSignature(quote);
      (mockedPrisma.tradeTransaction.findUnique as jest.Mock).mockResolvedValue(null);
      (mockedPrisma.tradeQuote.findUnique as jest.Mock).mockResolvedValue(quote as never);
      (mockedPrisma.tradeQuote.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({
        checkGasCeiling: jest.fn().mockResolvedValue({ ok: false, reason: 'exceeds ceiling' } satisfies EvmRelayerCeilingCheckResult),
      });

      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await expect(
        service.relay({ userId: quote.userId, walletAddress: quote.walletAddress, quoteId: quote.id, signature }),
      ).rejects.toThrow(/exceeds ceiling/);
      expect(relayer.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('submitFeeLegIfDue', () => {
    const FEE_TO = '0x3333333333333333333333333333333333333333' as const;
    const FEE_DATA = '0xfeefeefee';
    const FEE_VALUE = '0';

    function fakeConfirmedRow(overrides: Partial<Record<string, unknown>> = {}) {
      const quote = fakeQuoteRow();
      return {
        ...fakeCreatedTransactionRow(quote, '0xdeadbeef'),
        status: 'CONFIRMED',
        sponsoredByRelayer: true,
        feeTxHash: null,
        feeStatus: null,
        quote: { feeUnsignedTx: { to: FEE_TO, data: FEE_DATA, value: FEE_VALUE, gas: null, maxFeePerGas: null, maxPriorityFeePerGas: null } },
        ...overrides,
      };
    }

    it('is a no-op for a transaction that was not sponsored by the relayer', async () => {
      const relayer = fakeRelayer();
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow({ sponsoredByRelayer: false }) as never);

      expect(mockedPrisma.tradeTransaction.updateMany).not.toHaveBeenCalled();
      expect(relayer.simulate).not.toHaveBeenCalled();
    });

    it('is a no-op when the fee leg was already submitted', async () => {
      const relayer = fakeRelayer();
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow({ feeTxHash: '0xalreadysubmitted' }) as never);

      expect(mockedPrisma.tradeTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('is a no-op when the fee leg is already claimed (feeStatus set) by a concurrent call', async () => {
      const relayer = fakeRelayer();
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow({ feeStatus: 'PENDING' }) as never);

      expect(mockedPrisma.tradeTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('is a no-op when the trade is not eligible for the guaranteed-USDC fee flow', async () => {
      const relayer = fakeRelayer();
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow({ quote: { feeUnsignedTx: null } }) as never);

      expect(mockedPrisma.tradeTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('claims, simulates, checks the ceiling, broadcasts, and persists the fee leg', async () => {
      (mockedPrisma.tradeTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({ broadcast: jest.fn().mockResolvedValue({ txHash: '0xfeeleg', nonce: 8 } satisfies EvmRelayerBroadcastResult) });
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const row = fakeConfirmedRow();

      await service.submitFeeLegIfDue(row as never);

      expect(mockedPrisma.tradeTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: row.id, feeTxHash: null, feeStatus: null },
        data: { feeStatus: 'PENDING' },
      });
      expect(relayer.simulate).toHaveBeenCalledWith('base', { to: FEE_TO, data: FEE_DATA, value: 0n });
      expect(relayer.broadcast).toHaveBeenCalled();
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith({
        where: { id: row.id },
        data: { feeTxHash: '0xfeeleg', feeSubmittedAt: expect.any(Date) },
      });
    });

    it('never broadcasts when a concurrent call already claimed the fee leg', async () => {
      (mockedPrisma.tradeTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const relayer = fakeRelayer();
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow() as never);

      expect(relayer.simulate).not.toHaveBeenCalled();
      expect(relayer.broadcast).not.toHaveBeenCalled();
    });

    it('releases the claim and never broadcasts when the fee leg would fail on-chain — a revenue-loss event, not a user-facing failure', async () => {
      (mockedPrisma.tradeTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({ simulate: jest.fn().mockResolvedValue({ ok: false, reason: 'would revert' } satisfies EvmRelayerSimulationResult) });
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const row = fakeConfirmedRow();

      await service.submitFeeLegIfDue(row as never);

      expect(relayer.broadcast).not.toHaveBeenCalled();
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith({ where: { id: row.id }, data: { feeStatus: null } });
    });

    it('releases the claim and never broadcasts when the fee leg exceeds the gas ceiling', async () => {
      (mockedPrisma.tradeTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({ checkGasCeiling: jest.fn().mockResolvedValue({ ok: false, reason: 'too expensive' } satisfies EvmRelayerCeilingCheckResult) });
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const row = fakeConfirmedRow();

      await service.submitFeeLegIfDue(row as never);

      expect(relayer.broadcast).not.toHaveBeenCalled();
      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith({ where: { id: row.id }, data: { feeStatus: null } });
    });

    it('releases the claim when the broadcast itself throws — never leaves the claim stuck forever', async () => {
      (mockedPrisma.tradeTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const relayer = fakeRelayer({ broadcast: jest.fn().mockRejectedValue(new Error('RPC timeout')) });
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());
      const row = fakeConfirmedRow();

      await service.submitFeeLegIfDue(row as never);

      expect(mockedPrisma.tradeTransaction.update).toHaveBeenCalledWith({ where: { id: row.id }, data: { feeStatus: null } });
    });

    it('logs and no-ops without claiming when the relayer is no longer configured for this chain', async () => {
      const relayer = fakeRelayer({ isConfigured: jest.fn().mockReturnValue(false) });
      const service = new EvmGasRelayerQuoteService(fakeWallet(), relayer, fakeConfig(), fakeLogger());

      await service.submitFeeLegIfDue(fakeConfirmedRow() as never);

      expect(mockedPrisma.tradeTransaction.updateMany).not.toHaveBeenCalled();
    });
  });
});
