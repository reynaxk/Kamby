import { verifyMessage, verifyTypedData } from 'viem';
import type { TypedData } from 'viem';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

/**
 * Verifies that `signature` over `message` was produced by the private key controlling
 * `address` — the entire cryptographic core of wallet ownership verification (see
 * docs/TRADING.md#wallet-ownership). Pure EOA (personal_sign) verification: no RPC client
 * is passed, so a smart-contract wallet (ERC-1271 — Safe, some smart accounts) cannot be
 * verified this way and this returns `false` for one, never a false positive. Documented
 * limitation, not a silent gap — see docs/TRADING.md#known-limitations.
 *
 * Never throws on a malformed signature/address — a caller asking "did this address sign
 * this message" should get `false` for garbage input, not an exception to handle
 * separately from a genuine mismatch.
 */
export async function verifyEvmSignature(params: { address: string; message: string; signature: string }): Promise<boolean> {
  try {
    return await verifyMessage({
      address: params.address as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/**
 * Verifies an EIP-712 typed-data signature — the EVM gas relayer's real-time-consent proof
 * (see docs/GAS_RELAYER_PLAN.md's EVM section and packages/domain/src/evm-relayer.ts's
 * `buildRelayedSwapTypedData`, the one function that builds this exact `{domain, types,
 * primaryType, message}` shape for both what the client signs and what this verifies
 * against — never construct it a second, independent way, or the two can drift apart).
 * Unlike `verifyEvmSignature` (EIP-191, a flat string), EIP-712 signs a structured object,
 * which is what lets a wallet's signing UI render the actual fields being consented to
 * rather than an opaque blob. Same never-throws-on-garbage-input contract as
 * `verifyEvmSignature`: a malformed signature/address/typed-data shape is a `false`, not an
 * exception to handle separately from a genuine mismatch.
 */
export async function verifyEvmTypedDataSignature(params: {
  address: string;
  /** Plain strings, not viem's own branded `0x${string}` domain type — the caller
   *  (`packages/domain`'s `buildRelayedSwapTypedData`) deliberately has zero dependency on
   *  viem, so its output can only ever produce plain `string` fields. Cast to viem's real
   *  `TypedDataDomain` internally, at the one call site that actually needs it. */
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: string; salt?: string };
  types: TypedData;
  primaryType: string;
  message: Record<string, unknown>;
  signature: string;
}): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: params.address as `0x${string}`,
      domain: params.domain,
      types: params.types,
      primaryType: params.primaryType,
      message: params.message,
      signature: params.signature as `0x${string}`,
    } as Parameters<typeof verifyTypedData>[0]);
  } catch {
    return false;
  }
}

/**
 * Solana's counterpart to verifyEvmSignature — Ed25519 verification via tweetnacl, the
 * standard combination for this on Solana (a Solana address *is* its Ed25519 public key,
 * base58-encoded). `signature` is the base58-encoded 64-byte signature a Solana wallet
 * (e.g. Privy's embedded wallet, `signMessage`) returns after signing the UTF-8 bytes of
 * `message` directly — no additional message-wrapping step, unlike EIP-191/personal_sign
 * on the EVM side. Same never-throws-on-garbage-input contract as verifyEvmSignature: a
 * malformed base58 address or signature is a `false`, not an exception to handle
 * separately from a genuine mismatch.
 */
export function verifySolanaSignature(params: { address: string; message: string; signature: string }): boolean {
  try {
    const publicKeyBytes = bs58.decode(params.address);
    const signatureBytes = bs58.decode(params.signature);
    const messageBytes = new TextEncoder().encode(params.message);
    if (publicKeyBytes.length !== 32 || signatureBytes.length !== 64) return false;
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}
