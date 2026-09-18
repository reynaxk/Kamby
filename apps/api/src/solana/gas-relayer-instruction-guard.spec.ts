import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SOLANA_NATIVE_MINT } from '@kamby/domain';
import {
  JUPITER_V6_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID_SECONDARY,
  type ResolvedInstruction,
  validateRelayerInstructions,
} from './gas-relayer-instruction-guard';

const FEE_PAYER = 'FeePayerPubkeyForTestingOnly1111111111111';
const USER_WALLET = 'UserWalletPubkeyForTestingOnly11111111111';
const OTHER_MINT = 'So11111111111111111111111111111111111113'; // deliberately NOT the real native mint

function ix(programId: string, data: number[] = [], accounts: string[] = []): ResolvedInstruction {
  return { programId, data: new Uint8Array(data), accounts };
}

const context = { acceptableCloseDestinations: [FEE_PAYER, USER_WALLET] };
const validate = (instructions: ResolvedInstruction[]) => validateRelayerInstructions(instructions, context);

const jupiterRoute = () => ix(JUPITER_V6_PROGRAM_ID, [193, 32, 155, 51, 65, 214, 156, 129]); // sharedAccountsRoute discriminator, arbitrary rest
const computeBudget = () => ix(ComputeBudgetProgram.programId.toBase58(), [3]);
// Real ATA-program account layout, confirmed against @solana/spl-token's own source before
// writing this: [payer, associatedToken, owner, mint, SystemProgram, TokenProgram]. `Create`
// itself carries empty data; `CreateIdempotent` carries a single byte `1`.
const ataCreate = (associatedToken: string, mint: string = SOLANA_NATIVE_MINT) =>
  ix(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), [], [FEE_PAYER, associatedToken, USER_WALLET, mint, SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58()]);
const ataCreateIdempotent = (associatedToken: string, mint: string = SOLANA_NATIVE_MINT) =>
  ix(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), [1], [FEE_PAYER, associatedToken, USER_WALLET, mint, SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58()]);
const ataRecoverNested = (associatedToken: string) =>
  ix(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), [2], [associatedToken]); // a different op, same program id — never a create
// Real Token-program CloseAccount account layout: [account, destination, authority].
const tokenCloseAccount = (target: string, destination: string = FEE_PAYER, programId: string = TOKEN_PROGRAM_ID.toBase58()) =>
  ix(programId, [9], [target, destination, USER_WALLET]); // TokenInstruction.CloseAccount = 9
const tokenTransfer = () => ix(TOKEN_PROGRAM_ID.toBase58(), [3, 0, 0, 0, 0, 0, 0, 0, 0]); // TokenInstruction.Transfer = 3

describe('validateRelayerInstructions', () => {
  it('accepts a realistic Jupiter swap shape: compute budget + ATA create + one Jupiter route', () => {
    const result = validate([computeBudget(), ataCreate('someAta'), jupiterRoute()]);
    expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: [] });
  });

  it('accepts the secondary Jupiter deployment address as equally legitimate', () => {
    const result = validate([ix(JUPITER_V6_PROGRAM_ID_SECONDARY, [193, 32, 155, 51, 65, 214, 156, 129])]);
    expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: [] });
  });

  it('rejects a smuggled CloseAccount instruction with no matching same-tx creation, even alongside an otherwise-legitimate swap', () => {
    const result = validate([computeBudget(), jupiterRoute(), tokenCloseAccount('someRandomAta')]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/no matching creation/i) });
  });

  it('rejects a CloseAccount on the Token-2022 program too, not just the original Token program', () => {
    const result = validate([jupiterRoute(), tokenCloseAccount('someRandomAta', FEE_PAYER, TOKEN_2022_PROGRAM_ID.toBase58())]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/no matching creation/i) });
  });

  it('rejects any instruction targeting a program not on the allowlist', () => {
    // Not a program id at all — an arbitrary mint address (wSOL) — chosen specifically
    // because it proves the allowlist is a real allowlist, not an accidental "anything
    // that looks like a valid pubkey" pass-through.
    const result = validate([jupiterRoute(), ix('So11111111111111111111111111111111111111112')]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/not on the allowlist/i) });
  });

  it('allows a real SystemProgram transfer as part of a legitimate swap (e.g. SOL wrapping)', () => {
    const result = validate([ix(SystemProgram.programId.toBase58(), [2, 0, 0, 0]), jupiterRoute()]);
    expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: [] });
  });

  it('rejects a transaction with no Jupiter instruction at all — this relayer only sponsors an already-quoted swap', () => {
    const result = validate([computeBudget(), tokenTransfer()]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/no jupiter swap instruction/i) });
  });

  it('rejects a transaction bundling two Jupiter route instructions, not just one', () => {
    const result = validate([jupiterRoute(), jupiterRoute()]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/expected exactly one/i) });
  });

  it('rejects an empty instruction list', () => {
    const result = validate([]);
    expect(result.ok).toBe(false);
  });

  it('a legitimate ordinary Token transfer (not CloseAccount) alongside the swap is fine', () => {
    const result = validate([tokenTransfer(), jupiterRoute()]);
    expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: [] });
  });

  describe('WSOL-unwrap close exception', () => {
    it('accepts a genuine same-tx-created WSOL account closed back to the fee payer — the real Jupiter unwrap shape', () => {
      const result = validate([ataCreate('wsolAta'), jupiterRoute(), tokenCloseAccount('wsolAta', FEE_PAYER)]);
      expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: ['wsolAta'] });
    });

    it('accepts the same shape via CreateIdempotent, not just Create — both are real Jupiter-emitted forms', () => {
      const result = validate([ataCreateIdempotent('wsolAta'), jupiterRoute(), tokenCloseAccount('wsolAta', FEE_PAYER)]);
      expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: ['wsolAta'] });
    });

    it('accepts a close whose destination is the user\'s own wallet — Jupiter\'s real unwrap refunds the account owner, not the fee payer', () => {
      const result = validate([ataCreate('wsolAta'), jupiterRoute(), tokenCloseAccount('wsolAta', USER_WALLET)]);
      expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: ['wsolAta'] });
    });

    it('rejects a close whose destination is a third party — never an arbitrary address, even alongside a real matching creation', () => {
      const result = validate([ataCreate('wsolAta'), jupiterRoute(), tokenCloseAccount('wsolAta', 'SomeAttackerAddress1111111111111111111111')]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringMatching(/neither the fee payer nor the caller/i) });
    });

    it('rejects a close of a non-WSOL mint even with a real matching same-tx creation — never a general "any freshly-created ATA" exception', () => {
      const result = validate([ataCreate('someAta', OTHER_MINT), jupiterRoute(), tokenCloseAccount('someAta', FEE_PAYER)]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringMatching(/mint other than wrapped sol/i) });
    });

    it('rejects a close whose "creation" is actually a later instruction — a close can only reference something earlier in the same list', () => {
      const result = validate([jupiterRoute(), tokenCloseAccount('wsolAta', FEE_PAYER), ataCreate('wsolAta')]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringMatching(/no matching creation/i) });
    });

    it('rejects a close "matched" only against a RecoverNested instruction — same program id, but never a creation', () => {
      const result = validate([ataRecoverNested('wsolAta'), jupiterRoute(), tokenCloseAccount('wsolAta', FEE_PAYER)]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringMatching(/no matching creation/i) });
    });

    it('rejects more than two WSOL closes in one transaction, even if every one individually matches', () => {
      const result = validate([
        ataCreate('wsolAta1'),
        ataCreate('wsolAta2'),
        ataCreate('wsolAta3'),
        jupiterRoute(),
        tokenCloseAccount('wsolAta1', FEE_PAYER),
        tokenCloseAccount('wsolAta2', FEE_PAYER),
        tokenCloseAccount('wsolAta3', FEE_PAYER),
      ]);
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ reason: expect.stringMatching(/more than 2/i) });
    });

    it('accepts exactly two matched WSOL closes — a real wrap-then-unwrap pair', () => {
      const result = validate([
        ataCreate('wsolAta1'),
        ataCreate('wsolAta2'),
        jupiterRoute(),
        tokenCloseAccount('wsolAta1', FEE_PAYER),
        tokenCloseAccount('wsolAta2', USER_WALLET),
      ]);
      expect(result).toEqual({ ok: true, wsolClosesRequiringFreshnessCheck: ['wsolAta1', 'wsolAta2'] });
    });
  });
});
