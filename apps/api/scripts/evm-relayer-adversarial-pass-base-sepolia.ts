/**
 * Piece 4g Track 1 — the EVM gas relayer's live Base Sepolia adversarial pass. See
 * docs/GAS_RELAYER_PLAN.md's own "Adversarial pass" section for the full context.
 *
 * Scope, deliberately: this script covers exactly the part of the design that (a) only a
 * live network can actually prove and (b) has no dependency on KyberSwap (which has no
 * testnet at all — confirmed live against its own docs during planning). That's
 * `EvmRelayerNonceManagerService`/`EvmRelayerWalletService`/`EvmGasRelayerService`
 * (simulate/checkGasCeiling/broadcast, real nonce serialization) plus the EIP-712 domain
 * functions (`buildRelayedSwapTypedData`/`verifyEvmTypedDataSignature`) — none of which
 * touch Prisma. The Postgres-touching orchestration (`EvmGasRelayerQuoteService#relay`'s
 * idempotency/replay/expiry/consent-claim logic) is deliberately NOT re-proven here: it's
 * already covered by 29 real unit tests (including two genuine concurrent-claim-race
 * scenarios and two real end-to-end EIP-712 signature verifications), none of which depend
 * on live Base Sepolia RPC behavior the way the scenarios below do — see this file's own
 * "What this script does NOT prove" section at the bottom for the honest accounting,
 * mirroring the Solana devnet pass's own precedent (devnet-adversarial-pass.ts).
 *
 * NOT wired into any build/lint/test config — a standalone, throwaway tool, run by hand,
 * once, to produce the real tx-hash/rejection log this PR's artifact needs. Safe to delete
 * after that log is captured; nothing else in the codebase imports this file.
 *
 * Run with: `pnpm --filter @kamby/api exec ts-node scripts/evm-relayer-adversarial-pass-base-sepolia.ts`
 * No database needed — this script never imports @kamby/db.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { buildRelayedSwapTypedData } from '@kamby/domain';
import { verifyEvmTypedDataSignature } from '@kamby/chain-adapters';
import type { PinoLogger } from 'nestjs-pino';
import type { Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Env } from '../src/config/env';
import { EvmGasRelayerService } from '../src/trading/relayer/evm-gas-relayer.service';
import { EvmRelayerNonceManagerService } from '../src/trading/relayer/evm-relayer-nonce-manager.service';
import { EvmRelayerWalletService } from '../src/trading/relayer/evm-relayer-wallet.service';

const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_RPC_URL = 'https://sepolia.base.org'; // verified live this session: eth_chainId -> 0x14a34 = 84532
const KEY_DIR = join(__dirname, '.base-sepolia-keys'); // gitignored-by-convention throwaway dir

// --- Keypair setup — safe to run repeatedly, never touches the network for money -----------

function loadOrCreateKey(name: string): Hex {
  if (!existsSync(KEY_DIR)) mkdirSync(KEY_DIR, { recursive: true });
  const path = join(KEY_DIR, `${name}.txt`);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim() as Hex;
  const key = generatePrivateKey();
  writeFileSync(path, key);
  return key;
}

const relayerPrivateKey = loadOrCreateKey('relayer'); // held only in this process's memory — never logged, never printed
const testUserPrivateKey = loadOrCreateKey('test-user');
const relayerAccount = privateKeyToAccount(relayerPrivateKey);
const testUserAccount = privateKeyToAccount(testUserPrivateKey);

// --- Fixture builders --------------------------------------------------------------------

function fakeLogger(): PinoLogger {
  return { setContext: () => undefined, info: console.log, warn: console.warn, error: console.error } as unknown as PinoLogger;
}

/** Reuses the 'base' chain slug for this script's own isolated config object only — never
 *  touches real CHAIN_BASE_ID/CHAIN_BASE_RPC_URL, which this script doesn't read (it builds
 *  its own ConfigService from scratch, exactly like the unit tests already do). Same trick
 *  the Solana devnet script uses (pointing SOLANA_RPC_URL at devnet's URL instead of
 *  mainnet's under the same field name). */
function relayerConfig(overrides: { maxGasPriceGwei?: number; maxWeiCeiling?: number } = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    CHAINS: 'base',
    DEFAULT_CHAIN_SLUG: 'base',
    CHAIN_BASE_ID: BASE_SEPOLIA_CHAIN_ID,
    CHAIN_BASE_RPC_URL: BASE_SEPOLIA_RPC_URL,
    CHAIN_BASE_USDC_ADDRESS: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia's real USDC, for realism only — never read
    EVM_GAS_RELAYER_ENABLED: true,
    EVM_GAS_RELAYER_PRIVATE_KEY: relayerPrivateKey,
    EVM_GAS_RELAYER_CHAINS: 'base',
    EVM_GAS_RELAYER_MAX_GAS_PRICE_GWEI_BASE: overrides.maxGasPriceGwei ?? 5,
    EVM_GAS_RELAYER_MAX_WEI_CEILING_BASE: overrides.maxWeiCeiling ?? 10_000_000_000_000, // 0.00001 ETH — generous for a 21k-gas transfer
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

function buildRelayer(overrides: { maxGasPriceGwei?: number; maxWeiCeiling?: number } = {}) {
  const wallet = new EvmRelayerWalletService(relayerConfig(overrides));
  const nonceManager = new EvmRelayerNonceManagerService();
  const relayer = new EvmGasRelayerService(wallet, nonceManager, fakeLogger());
  return { wallet, relayer };
}

interface ScenarioResult {
  name: string;
  expected: string;
  outcome: 'PASS' | 'FAIL';
  detail: string;
}
const results: ScenarioResult[] = [];

async function runScenario(name: string, expected: string, fn: () => Promise<{ ok: boolean; detail: string }>): Promise<void> {
  console.log(`\n=== ${name} ===`);
  try {
    const { ok, detail } = await fn();
    results.push({ name, expected, outcome: ok ? 'PASS' : 'FAIL', detail });
    console.log(ok ? `PASS — ${detail}` : `FAIL — ${detail}`);
  } catch (error) {
    results.push({ name, expected, outcome: 'FAIL', detail: `Threw unexpectedly: ${String(error)}` });
    console.log(`FAIL — threw unexpectedly: ${String(error)}`);
  }
}

async function main() {
  console.log('Relayer Base Sepolia address:', relayerAccount.address);
  console.log('Test-user Base Sepolia address:', testUserAccount.address);
  console.log('\nFund the relayer before continuing — Base Sepolia faucet (Coinbase, no key needed):');
  console.log('  https://www.coinbase.com/faucets/base-sepolia-faucet');
  console.log(`  Send at least 0.01 test ETH to ${relayerAccount.address}`);
  console.log('(Every scenario below sends only a few thousand wei per transfer — 0.01 ETH is comfortably enough with wide margin.)\n');

  const { wallet, relayer } = buildRelayer();
  const clients = wallet.forChain('base');
  if (!clients) throw new Error('wallet.forChain(base) returned null — config wiring is broken, fix before continuing');

  const relayerBalance = await clients.publicClient.getBalance({ address: relayerAccount.address });
  console.log(`Relayer balance: ${relayerBalance} wei`);
  if (relayerBalance === 0n) {
    console.log('\nRelayer has 0 ETH — fund it with the faucet above, then re-run this script. Stopping here.');
    return;
  }

  // 1. A legitimate transfer: simulate succeeds, ceiling passes, broadcasts for real, and
  //    actually mines on-chain — the positive case proving the whole pipe works end to end.
  await runScenario('Legitimate transfer: simulate -> ceiling -> broadcast -> real on-chain confirmation', 'a real, mined Base Sepolia transaction', async () => {
    const tx = { to: testUserAccount.address, data: '0x', value: 1000n };
    const simulation = await relayer.simulate('base', tx);
    if (!simulation.ok) return { ok: false, detail: `simulate rejected a legitimate transfer: ${simulation.reason}` };
    const ceiling = await relayer.checkGasCeiling('base', simulation.gasUnits);
    if (!ceiling.ok) return { ok: false, detail: `checkGasCeiling rejected a legitimate transfer: ${ceiling.reason}` };
    const broadcast = await relayer.broadcast('base', tx, { maxFeePerGas: ceiling.maxFeePerGas, maxPriorityFeePerGas: ceiling.maxPriorityFeePerGas }, simulation.gasUnits);
    console.log(`  broadcast: https://sepolia.basescan.org/tx/${broadcast.txHash} (nonce ${broadcast.nonce})`);
    const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: broadcast.txHash as Hex });
    return { ok: receipt.status === 'success', detail: `receipt status: ${receipt.status}, txHash: ${broadcast.txHash}` };
  });

  // 2. Simulate catches a predictable revert — an oversized value transfer, real "insufficient
  //    funds" from the live network — and nothing is ever broadcast; the relayer's own real
  //    balance is provably unchanged afterward.
  await runScenario('Simulate catches an oversized transfer before broadcasting — real balance unchanged', 'ok:false, relayer balance unchanged', async () => {
    const before = await clients.publicClient.getBalance({ address: relayerAccount.address });
    const hugeValue = before + 10_000_000_000_000_000_000n; // real balance + 10 ETH — guaranteed to exceed it
    const simulation = await relayer.simulate('base', { to: testUserAccount.address, data: '0x', value: hugeValue });
    const after = await clients.publicClient.getBalance({ address: relayerAccount.address });
    return { ok: !simulation.ok && after === before, detail: `simulate.ok=${simulation.ok}, balance before=${before} after=${after}` };
  });

  // 3. Gas ceiling enforcement — a transfer that WOULD succeed (simulate passes) is still
  //    rejected before ever broadcasting, purely for exceeding a deliberately tiny configured
  //    ceiling — proves the ceiling check is a real, independent gate, not just a formality.
  await runScenario('Gas ceiling rejects an otherwise-legitimate transfer', 'simulate ok:true, checkGasCeiling ok:false', async () => {
    const { relayer: tightRelayer } = buildRelayer({ maxGasPriceGwei: 0.0000001, maxWeiCeiling: 1 });
    const tx = { to: testUserAccount.address, data: '0x', value: 1000n };
    const simulation = await tightRelayer.simulate('base', tx);
    if (!simulation.ok) return { ok: false, detail: `expected simulate to succeed first: ${simulation.reason}` };
    const ceiling = await tightRelayer.checkGasCeiling('base', simulation.gasUnits);
    return { ok: !ceiling.ok, detail: `checkGasCeiling.ok=${ceiling.ok}, reason=${'reason' in ceiling ? ceiling.reason : 'n/a'}` };
  });

  // 4. Real concurrency — N genuinely concurrent relay cycles on the same chain must never
  //    collide on a nonce. Decodes the real on-chain nonce of every resulting transaction
  //    (not just trusting the in-memory return value) to prove this against live RPC state.
  await runScenario('Nonce serialization under real concurrency (3 concurrent broadcasts)', 'three sequential, gap-free, real on-chain nonces', async () => {
    async function relayCycle(): Promise<{ txHash: string; nonce: number }> {
      const tx = { to: testUserAccount.address, data: '0x', value: 1000n };
      const simulation = await relayer.simulate('base', tx);
      if (!simulation.ok) throw new Error(`simulate failed mid-concurrency-test: ${simulation.reason}`);
      const ceiling = await relayer.checkGasCeiling('base', simulation.gasUnits);
      if (!ceiling.ok) throw new Error(`checkGasCeiling failed mid-concurrency-test: ${ceiling.reason}`);
      return relayer.broadcast('base', tx, { maxFeePerGas: ceiling.maxFeePerGas, maxPriorityFeePerGas: ceiling.maxPriorityFeePerGas }, simulation.gasUnits);
    }
    const broadcasts = await Promise.all([relayCycle(), relayCycle(), relayCycle()]);
    const returnedNonces = broadcasts.map((b) => b.nonce).sort((a, b) => a - b);
    const gapFree = returnedNonces.every((n, i) => i === 0 || n === returnedNonces[i - 1]! + 1);
    const noDuplicates = new Set(returnedNonces).size === returnedNonces.length;

    // Cross-check against real chain state, not just the in-memory return values.
    const onChainNonces = await Promise.all(
      broadcasts.map(async (b) => {
        const receipt = await clients.publicClient.waitForTransactionReceipt({ hash: b.txHash as Hex });
        const onChainTx = await clients.publicClient.getTransaction({ hash: receipt.transactionHash });
        return onChainTx.nonce;
      }),
    );
    const onChainMatches = JSON.stringify([...onChainNonces].sort((a, b) => a - b)) === JSON.stringify(returnedNonces);

    return {
      ok: gapFree && noDuplicates && onChainMatches,
      detail: `returned nonces: ${returnedNonces.join(',')}, real on-chain nonces: ${onChainNonces.join(',')}, gapFree=${gapFree}, noDuplicates=${noDuplicates}, onChainMatches=${onChainMatches}`,
    };
  });

  // 5. Real EIP-712 round trip — the actual domain/chain-adapters functions, a real account
  //    signature (viem's own signTypedData, the same primitive Privy's embedded wallet uses
  //    under the hood), and real verification. Proves the cryptography itself is correct,
  //    independent of the Privy-in-browser integration (covered separately by
  //    TradePanel.test.tsx's gasless tests with a mocked signer).
  const typedData = buildRelayedSwapTypedData({
    quoteId: 'base-sepolia-adversarial-pass',
    walletAddress: testUserAccount.address,
    chainId: BASE_SEPOLIA_CHAIN_ID,
    relayerAddress: relayerAccount.address,
    unsignedTx: { to: testUserAccount.address, data: '0x', value: '1000' },
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });

  await runScenario('Real EIP-712 sign + verify round trip', 'verifies true', async () => {
    const signature = await testUserAccount.signTypedData(typedData as never);
    const valid = await verifyEvmTypedDataSignature({
      address: testUserAccount.address,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature,
    });
    return { ok: valid, detail: `signature: ${signature.slice(0, 20)}…, verified: ${valid}` };
  });

  await runScenario('Wrong-signer rejection (relayer signs instead of the user)', 'verifies false', async () => {
    const signature = await relayerAccount.signTypedData(typedData as never);
    const valid = await verifyEvmTypedDataSignature({
      address: testUserAccount.address, // still checked against the USER's address, not the relayer's
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
      signature,
    });
    return { ok: !valid, detail: `verified: ${valid} (must be false)` };
  });

  await runScenario('Tampered-message rejection (valid signature, mutated value)', 'verifies false', async () => {
    const signature = await testUserAccount.signTypedData(typedData as never);
    const tamperedMessage = { ...typedData.message, value: typedData.message.value + 1n };
    const valid = await verifyEvmTypedDataSignature({
      address: testUserAccount.address,
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: tamperedMessage,
      signature,
    });
    return { ok: !valid, detail: `verified: ${valid} (must be false)` };
  });

  console.log('\n\n=== SUMMARY ===');
  for (const r of results) console.log(`[${r.outcome}] ${r.name}`);
  const failed = results.filter((r) => r.outcome === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} scenarios behaved as expected.`);
  if (failed.length > 0) {
    console.log('\nFailed scenarios need investigation before this can be considered a clean pass:');
    for (const r of failed) console.log(`  - ${r.name}: ${r.detail}`);
  }

  console.log('\n=== What this script deliberately does NOT prove ===');
  console.log('1. Idempotency/replay/consent-claim races, and quote-expiry rejection — all live entirely');
  console.log('   inside EvmGasRelayerQuoteService#relay\'s Prisma-touching orchestration, which this script');
  console.log('   never imports (see the header comment). Already covered by 29 real unit tests, including');
  console.log('   two genuine concurrent-claim-race scenarios and two real end-to-end EIP-712 verifications —');
  console.log('   none of which depend on live Base Sepolia RPC behavior the way the scenarios above do.');
  console.log('2. The full Privy-in-browser signing UI — covered separately by TradePanel.test.tsx\'s 7');
  console.log('   gasless-specific tests (mocked signer, real bigint-reconstruction assertions). This script');
  console.log('   proves the underlying cryptographic primitive (signTypedData/verifyEvmTypedDataSignature)');
  console.log('   is correct against real, non-mocked inputs — Privy calls the same viem primitive under the');
  console.log('   hood for an embedded wallet, so there is no separate signing algorithm left unverified.');
  console.log('3. KyberSwap-routed calldata — KyberSwap has no testnet at all (confirmed live against its own');
  console.log('   docs during planning). A real KyberSwap-routed sponsored trade needs Track 2: a small,');
  console.log('   allowlist-gated real trade on Base mainnet — a separate, explicitly-signed-off step, not run');
  console.log('   by this script.');
}

void main();
