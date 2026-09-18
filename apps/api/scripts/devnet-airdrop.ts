/** One-off helper: requests a devnet airdrop for both keypairs devnet-adversarial-pass.ts
 *  already generated, via the same underlying RPC call the `solana airdrop` CLI makes
 *  (the CLI binary isn't installed in this environment). Throwaway, not wired into any
 *  build/lint/test config — same treatment as devnet-adversarial-pass.ts itself. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const KEYPAIR_DIR = join(__dirname, '.devnet-keys');

function loadKeypair(name: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(join(KEYPAIR_DIR, `${name}.json`), 'utf8')) as number[]);
  return Keypair.fromSecretKey(secret);
}

async function airdropAndConfirm(connection: Connection, pubkey: Keypair['publicKey'], sol: number, label: string): Promise<void> {
  console.log(`Requesting ${sol} SOL for ${label} (${pubkey.toBase58()})...`);
  try {
    const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash('confirmed');
    await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
    const balance = await connection.getBalance(pubkey, 'confirmed');
    console.log(`  done — signature ${sig}, balance now ${balance / LAMPORTS_PER_SOL} SOL`);
  } catch (error) {
    console.log(`  FAILED: ${String(error)}`);
  }
}

async function main() {
  const connection = new Connection(DEVNET_RPC_URL, 'confirmed');
  const relayer = loadKeypair('relayer');
  const testUser = loadKeypair('test-user');

  await airdropAndConfirm(connection, relayer.publicKey, 2, 'relayer');
  await airdropAndConfirm(connection, testUser.publicKey, 1, 'test-user');
}

void main();
