import { prisma } from '@kamby/db';
import { chatTokenKey, EVM_USDC_BY_CHAIN_ID, SOLANA_USDC_MINT, TOKEN_CHAT_REALTIME_CHANNEL, type TokenChatEvent } from '@kamby/domain';

interface Publisher {
  publish(channel: string, message: string): Promise<unknown>;
}

const AUTHOR_SELECT = {
  username: true,
  avatarUrl: true,
  wallets: { where: { verifiedAt: { not: null } }, orderBy: { verifiedAt: 'asc' as const }, take: 1, select: { address: true } },
};

/**
 * A trade the sweep confirmed (the user had left before the app saw it) still shows in its
 * coin's live chat — the worker-side twin of apps/api's announceTradeInChat (2026-10-14). The
 * dollar amount is the trade's USDC leg; a trade without one isn't announced. Best effort:
 * never throws, a miss only means viewers see it on their next load.
 */
export async function announceSweptTrade(redis: Publisher, ref: { evmTransactionId: string } | { solanaTransactionId: string }): Promise<void> {
  try {
    let event: TokenChatEvent | null = null;
    if ('evmTransactionId' in ref) {
      const row = await prisma.tradeTransaction.findUnique({
        where: { id: ref.evmTransactionId },
        select: {
          id: true,
          side: true,
          chainId: true,
          inputToken: true,
          outputToken: true,
          inputAmount: true,
          expectedOutputAmount: true,
          tokenMarket: { select: { token: { select: { contractAddress: true } } } },
          user: { select: AUTHOR_SELECT },
        },
      });
      const usdc = row ? EVM_USDC_BY_CHAIN_ID[row.chainId] : undefined;
      if (!row || !usdc) return;
      const usdcLeg = row.side === 'BUY' ? row.inputToken : row.outputToken;
      if (!usdcLeg || usdcLeg.toLowerCase() !== usdc.address.toLowerCase()) return;
      const usd = Number(row.side === 'BUY' ? row.inputAmount : row.expectedOutputAmount) / 10 ** usdc.decimals;
      const tokenKey = chatTokenKey(`eip155:${row.chainId}`, row.tokenMarket.token.contractAddress);
      if (tokenKey && usd > 0) event = item(row.id, tokenKey, row.side, usd, row.user);
    } else {
      const row = await prisma.solanaTradeTransaction.findUnique({
        where: { id: ref.solanaTransactionId },
        select: { id: true, side: true, inputMint: true, outputMint: true, inputAmount: true, expectedOutputAmount: true, user: { select: AUTHOR_SELECT } },
      });
      if (!row) return;
      const sell = row.side === 'SELL';
      if ((sell ? row.outputMint : row.inputMint) !== SOLANA_USDC_MINT) return;
      const usd = Number(sell ? row.expectedOutputAmount : row.inputAmount) / 1e6;
      const tokenKey = chatTokenKey('solana', sell ? row.inputMint : row.outputMint);
      if (tokenKey && usd > 0) event = item(row.id, tokenKey, row.side, usd, row.user);
    }
    if (event) await redis.publish(TOKEN_CHAT_REALTIME_CHANNEL, JSON.stringify(event));
  } catch {
    // best effort
  }
}

function item(
  id: string,
  tokenKey: string,
  side: string,
  usd: number,
  user: { username: string | null; avatarUrl: string | null; wallets: { address: string }[] },
): TokenChatEvent {
  return {
    type: 'item',
    item: {
      kind: 'trade',
      id,
      tokenKey,
      createdAt: new Date().toISOString(),
      author: { username: user.username, avatarUrl: user.avatarUrl, address: user.wallets[0]?.address ?? null },
      side: side === 'SELL' ? 'SELL' : 'BUY',
      usd,
    },
  };
}
