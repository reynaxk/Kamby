import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const HEX_SIGNATURE_REGEX = /^0x[a-fA-F0-9]+$/;

/**
 * `POST /trade/relay`'s request body — deliberately carries only `{quoteId, walletAddress,
 * signature}`, never `to`/`data`/`value` fields. This is not an oversight to fill in later:
 * it's the entire point of the design (see EvmGasRelayerService's own "core safety design"
 * doc comment) — a transaction's real contents are always re-derived from the persisted
 * `TradeQuote` row by `quoteId`, never trusted from the request, so there is structurally
 * nothing on this DTO a client could substitute even by accident.
 */
export class RelaySwapDto {
  @IsUUID()
  quoteId!: string;

  @Matches(EVM_ADDRESS_REGEX, { message: 'walletAddress must be a valid EVM address' })
  walletAddress!: string;

  /** The EIP-712 signature over the typed-data object `GET /trade/quote` returned as
   *  `consentTypedData` — see docs/GAS_RELAYER_PLAN.md's EVM section. */
  @IsString()
  @Matches(HEX_SIGNATURE_REGEX, { message: 'signature must be a 0x-prefixed hex string' })
  @MaxLength(1024)
  signature!: string;
}
