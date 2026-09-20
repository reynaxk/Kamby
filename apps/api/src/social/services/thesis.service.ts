import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@kamby/db';
import { identifierForChainId, type TokenThesis } from '@kamby/domain';

/** Same guard as market.service.ts's own `requireChainIdentifier` — duplicated rather than
 *  imported since that one is a private, unexported helper local to a different module. */
function requireChainIdentifier(chainId: number): string {
  const identifier = identifierForChainId(chainId);
  if (!identifier) throw new NotFoundException(`Chain id ${chainId} is not a chain Kamby trades on`);
  return identifier;
}

/**
 * Owns TokenThesis — see its own doc comment in schema.prisma. EVM-only for now (the only
 * place this renders is the EVM market terminal's Holders table), same scope note as
 * @kamby/domain's TokenThesisSchema.
 */
@Injectable()
export class ThesisService {
  async getForToken(chainId: number, tokenAddress: string, limit: number): Promise<TokenThesis[]> {
    const chainIdentifier = requireChainIdentifier(chainId);
    const token = await prisma.token.findFirst({
      where: { chain: { identifier: chainIdentifier }, contractAddress: { equals: tokenAddress, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!token) return [];

    const rows = await prisma.tokenThesis.findMany({
      where: { chain: 'EVM', evmTokenId: token.id },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    if (rows.length === 0) return [];

    // Same batched-identity pattern as LeaderboardService.getLeaderboard: one query per
    // rendered field, never one per row.
    const userIds = rows.map((r) => r.userId);
    const [users, wallets] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, avatarUrl: true } }),
      prisma.wallet.findMany({
        where: { userId: { in: userIds }, verifiedAt: { not: null } },
        orderBy: { lastUsedAt: 'desc' },
        select: { userId: true, address: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const walletByUserId = new Map<string, string>();
    for (const w of wallets) {
      if (!w.userId || walletByUserId.has(w.userId)) continue;
      walletByUserId.set(w.userId, w.address);
    }

    return rows.map((row) => {
      const user = userById.get(row.userId) ?? null;
      return {
        userId: row.userId,
        username: user?.username ?? null,
        avatarUrl: user?.avatarUrl ?? null,
        walletAddress: walletByUserId.get(row.userId) ?? null,
        text: row.text,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  /** A plain upsert — a thesis is a live opinion, not an append-only ledger (see the model's
   *  own doc comment), so re-setting one just overwrites the previous text in place. */
  async setMine(userId: string, chainId: number, tokenAddress: string, text: string): Promise<TokenThesis> {
    const chainIdentifier = requireChainIdentifier(chainId);
    const token = await prisma.token.findFirst({
      where: { chain: { identifier: chainIdentifier }, contractAddress: { equals: tokenAddress, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!token) {
      throw new NotFoundException(`No tracked token for address "${tokenAddress}" on this chain`);
    }

    const row = await prisma.tokenThesis.upsert({
      where: { userId_chain_evmTokenId: { userId, chain: 'EVM', evmTokenId: token.id } },
      create: { userId, chain: 'EVM', evmTokenId: token.id, text },
      update: { text },
    });

    const [user, wallet] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, avatarUrl: true } }),
      prisma.wallet.findFirst({
        where: { userId, verifiedAt: { not: null } },
        orderBy: { lastUsedAt: 'desc' },
        select: { address: true },
      }),
    ]);

    return {
      userId,
      username: user?.username ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      walletAddress: wallet?.address ?? null,
      text: row.text,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
