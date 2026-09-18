import { z } from 'zod';
import { normalizeEvmAddress } from './wallet';

/**
 * The EVM gas relayer's EIP-712 consent object — see docs/GAS_RELAYER_PLAN.md's EVM
 * section for the full trust-model reasoning. On Solana the relayer *co-signs*, so the
 * user's own signature is physically present in the executed transaction, directly
 * proving consent for that specific transaction. On EVM, a meta-transaction relayer
 * submits the entire transaction with only its own signature — the user never signs the
 * outer transaction at all. This typed-data object is what closes that gap: a real-time,
 * cryptographic proof that the wallet owner consented to *this exact* quote (this `to`,
 * this `data`, this `value`) being executed *now*, before the relayer ever spends gas on
 * it. It authorizes nothing on its own — the user's own separately-granted, standing
 * `approve()` to the router contract remains the sole source of token-movement authority,
 * unchanged from the self-paid flow (see QuoteService's own doc comments). This is
 * consent, not custody.
 *
 * Signs the **literal** `to`/`data`/`value`, not an opaque hash of them — a wallet's
 * typed-data signing UI renders message fields to the user, and signing only a hash would
 * have the user "consenting" to something they cannot see, defeating the entire point of
 * using EIP-712 over blind trust. (Honest limitation: `data` still renders as raw hex, not
 * decoded calldata — real human-readability has to come from Kamby's own consent-step UI
 * copy, not the wallet's typed-data modal alone.)
 */
export const RELAYED_SWAP_TYPED_DATA_TYPES = {
  RelayedSwap: [
    { name: 'quoteId', type: 'string' },
    { name: 'wallet', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'data', type: 'bytes' },
    { name: 'value', type: 'uint256' },
    { name: 'chainId', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

export interface RelayedSwapTypedData {
  domain: {
    name: 'Kamby';
    version: '1';
    chainId: number;
    /** Domain-separation salt only — there is no on-chain verifier contract; verification
     *  happens off-chain, in Node, via verifyEvmTypedDataSignature (@kamby/chain-adapters).
     *  The relayer's own address, so a signature produced for one relayer deployment can
     *  never be replayed against a different one (e.g. after a key rotation). */
    verifyingContract: string;
  };
  types: typeof RELAYED_SWAP_TYPED_DATA_TYPES;
  primaryType: 'RelayedSwap';
  message: {
    quoteId: string;
    wallet: string;
    to: string;
    data: string;
    value: bigint;
    chainId: bigint;
    expiry: bigint;
  };
}

/** Everything `buildRelayedSwapTypedData` needs — deliberately the exact shape a
 *  `TradeQuote` row (plus the relayer's own address) already carries, since this function
 *  is called from two places that must never independently reconstruct this object: once
 *  when the quote response is built (what the client is asked to sign) and once during
 *  verification (what the server reconstructs from the persisted row) — see
 *  EvmGasRelayerService's own doc comment. */
export interface RelayedSwapConsentSource {
  quoteId: string;
  walletAddress: string;
  chainId: number;
  relayerAddress: string;
  /** Only the fields the user is actually consenting to move/spend — deliberately
   *  excludes `gas`/`maxFeePerGas`/`maxPriorityFeePerGas` from TradeQuote.unsignedTx: gas
   *  pricing is decided at broadcast time from live network conditions (see the relayer's
   *  own pre-broadcast simulation/ceiling checks), not something to lock a user's
   *  signature to ahead of time. */
  unsignedTx: { to: string; data: string; value: string };
  expiresAt: Date;
}

/**
 * Builds the EIP-712 typed-data object described above. Pure and deterministic: the same
 * `RelayedSwapConsentSource` always produces the same object, byte-for-byte — the only
 * property that lets the quote-response path (what the client signs) and the verification
 * path (what the server checks the signature against) stay guaranteed in sync without ever
 * duplicating this construction logic. See `transactionMatchesQuote` (./trading.ts) for
 * the second, independent, business-logic-derived check the relayer runs *in addition to*
 * this signature — the two together are the defense-in-depth pairing described in
 * docs/GAS_RELAYER_PLAN.md's "applying the Piece 3 incident lesson" section.
 */
export function buildRelayedSwapTypedData(input: RelayedSwapConsentSource): RelayedSwapTypedData {
  return {
    domain: {
      name: 'Kamby',
      version: '1',
      chainId: input.chainId,
      verifyingContract: normalizeEvmAddress(input.relayerAddress),
    },
    types: RELAYED_SWAP_TYPED_DATA_TYPES,
    primaryType: 'RelayedSwap',
    message: {
      quoteId: input.quoteId,
      wallet: normalizeEvmAddress(input.walletAddress),
      to: normalizeEvmAddress(input.unsignedTx.to),
      data: input.unsignedTx.data,
      value: BigInt(input.unsignedTx.value),
      chainId: BigInt(input.chainId),
      expiry: BigInt(Math.floor(input.expiresAt.getTime() / 1000)),
    },
  };
}

/**
 * The JSON-safe wire form of `RelayedSwapTypedData` — a quote response crosses the wire as
 * JSON, and `bigint` cannot be JSON-serialized at all (`JSON.stringify` throws on one), so
 * `value`/`chainId`/`expiry` become decimal strings here, matching this codebase's own
 * "raw integer amounts are always strings over the wire" convention
 * (docs/TRADING.md#financial-precision) — never a JS `number`, which could silently lose
 * precision on a large uint256. The client (Privy's `useSignTypedData`) must convert these
 * back to `bigint` before actually signing — `parseRelayedSwapTypedDataWire` below does
 * that same conversion, so both the (eventual) frontend code and any Node-side caller share
 * one place that knows the exact field list.
 */
export interface RelayedSwapTypedDataWire {
  domain: RelayedSwapTypedData['domain'];
  types: typeof RELAYED_SWAP_TYPED_DATA_TYPES;
  primaryType: 'RelayedSwap';
  message: {
    quoteId: string;
    wallet: string;
    to: string;
    data: string;
    value: string;
    chainId: string;
    expiry: string;
  };
}

export function toWireTypedData(typedData: RelayedSwapTypedData): RelayedSwapTypedDataWire {
  return {
    ...typedData,
    message: {
      ...typedData.message,
      value: typedData.message.value.toString(),
      chainId: typedData.message.chainId.toString(),
      expiry: typedData.message.expiry.toString(),
    },
  };
}

/** The inverse of `toWireTypedData` — reconstructs the real-`bigint` object viem's
 *  `signTypedData`/`verifyTypedData` actually need from the JSON-safe wire form. */
export function parseRelayedSwapTypedDataWire(wire: RelayedSwapTypedDataWire): RelayedSwapTypedData {
  return {
    ...wire,
    message: {
      ...wire.message,
      value: BigInt(wire.message.value),
      chainId: BigInt(wire.message.chainId),
      expiry: BigInt(wire.message.expiry),
    },
  };
}

const RelayedSwapTypedDataTypeFieldSchema = z.object({ name: z.string(), type: z.string() });

/** Validates the wire (string-fielded) shape — the form this object actually takes at
 *  every API/network boundary. See `RelayedSwapTypedDataWire`'s own doc comment for why
 *  the numeric fields are strings, not the `bigint`s `RelayedSwapTypedData` itself carries
 *  internally. */
export const RelayedSwapTypedDataWireSchema = z.object({
  domain: z.object({
    name: z.literal('Kamby'),
    version: z.literal('1'),
    chainId: z.number().int().positive(),
    verifyingContract: z.string(),
  }),
  types: z.object({ RelayedSwap: z.array(RelayedSwapTypedDataTypeFieldSchema).readonly() }),
  primaryType: z.literal('RelayedSwap'),
  message: z.object({
    quoteId: z.string(),
    wallet: z.string(),
    to: z.string(),
    data: z.string(),
    value: z.string(),
    chainId: z.string(),
    expiry: z.string(),
  }),
});
