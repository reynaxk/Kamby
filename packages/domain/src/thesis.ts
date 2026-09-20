import { z } from 'zod';

/** Matches token_theses.text's `@db.VarChar(280)` in schema.prisma — validated here before
 *  it ever reaches that column, same "app validates, DB just enforces" split as everywhere
 *  else in this codebase (e.g. User.username). */
export const THESIS_MAX_LENGTH = 280;

/** A trader's own short note on why they're holding a token — see TokenThesis's own doc
 *  comment in schema.prisma. One per user per token, always the current text (editable in
 *  place, not a history). EVM-only for now: the only place this renders is the EVM market
 *  terminal's Holders table (TokenTradersPanel) — see docs/TRADING.md#pump-fun-trenches on
 *  why Solana has no per-token trading surface yet for a thesis to attach to there either. */
export const TokenThesisSchema = z.object({
  userId: z.string().uuid(),
  username: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  walletAddress: z.string().nullable(),
  text: z.string().min(1).max(THESIS_MAX_LENGTH),
  updatedAt: z.string().datetime(),
});
export type TokenThesis = z.infer<typeof TokenThesisSchema>;

export const SetThesisSchema = z.object({
  text: z.string().trim().min(1, 'Thesis cannot be empty').max(THESIS_MAX_LENGTH),
});
export type SetThesisInput = z.infer<typeof SetThesisSchema>;
