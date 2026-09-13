import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  JUPITER_V6_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID_SECONDARY,
  type ResolvedInstruction,
  validateRelayerInstructions,
} from './gas-relayer-instruction-guard';

function ix(programId: string, data: number[] = []): ResolvedInstruction {
  return { programId, data: new Uint8Array(data) };
}

const jupiterRoute = () => ix(JUPITER_V6_PROGRAM_ID, [193, 32, 155, 51, 65, 214, 156, 129]); // sharedAccountsRoute discriminator, arbitrary rest
const computeBudget = () => ix(ComputeBudgetProgram.programId.toBase58(), [3]);
const ataCreate = () => ix(ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(), [0]); // ATA program "create" has no meaningful discriminator byte
const tokenCloseAccount = (programId: string = TOKEN_PROGRAM_ID.toBase58()) => ix(programId, [9]); // TokenInstruction.CloseAccount = 9
const tokenTransfer = () => ix(TOKEN_PROGRAM_ID.toBase58(), [3, 0, 0, 0, 0, 0, 0, 0, 0]); // TokenInstruction.Transfer = 3

describe('validateRelayerInstructions', () => {
  it('accepts a realistic Jupiter swap shape: compute budget + ATA create + one Jupiter route', () => {
    const result = validateRelayerInstructions([computeBudget(), ataCreate(), jupiterRoute()]);
    expect(result).toEqual({ ok: true });
  });

  it('accepts the secondary Jupiter deployment address as equally legitimate', () => {
    const result = validateRelayerInstructions([ix(JUPITER_V6_PROGRAM_ID_SECONDARY, [193, 32, 155, 51, 65, 214, 156, 129])]);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a smuggled CloseAccount instruction outright, even alongside an otherwise-legitimate swap', () => {
    const result = validateRelayerInstructions([computeBudget(), ataCreate(), jupiterRoute(), tokenCloseAccount()]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/closes a token account/i) });
  });

  it('rejects a CloseAccount on the Token-2022 program too, not just the original Token program', () => {
    const result = validateRelayerInstructions([jupiterRoute(), tokenCloseAccount(TOKEN_2022_PROGRAM_ID.toBase58())]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/closes a token account/i) });
  });

  it('rejects any instruction targeting a program not on the allowlist', () => {
    // Not a program id at all — an arbitrary mint address (wSOL) — chosen specifically
    // because it proves the allowlist is a real allowlist, not an accidental "anything
    // that looks like a valid pubkey" pass-through.
    const result = validateRelayerInstructions([jupiterRoute(), ix('So11111111111111111111111111111111111111112')]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/not on the allowlist/i) });
  });

  it('allows a real SystemProgram transfer as part of a legitimate swap (e.g. SOL wrapping)', () => {
    const result = validateRelayerInstructions([ix(SystemProgram.programId.toBase58(), [2, 0, 0, 0]), jupiterRoute()]);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a transaction with no Jupiter instruction at all — this relayer only sponsors an already-quoted swap', () => {
    const result = validateRelayerInstructions([computeBudget(), tokenTransfer()]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/no jupiter swap instruction/i) });
  });

  it('rejects a transaction bundling two Jupiter route instructions, not just one', () => {
    const result = validateRelayerInstructions([jupiterRoute(), jupiterRoute()]);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/expected exactly one/i) });
  });

  it('rejects an empty instruction list', () => {
    const result = validateRelayerInstructions([]);
    expect(result.ok).toBe(false);
  });

  it('a legitimate ordinary Token transfer (not CloseAccount) alongside the swap is fine', () => {
    const result = validateRelayerInstructions([tokenTransfer(), jupiterRoute()]);
    expect(result).toEqual({ ok: true });
  });
});
