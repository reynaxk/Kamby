import { prisma } from '@kamby/db';

/**
 * Coming back on a new device (2026-10-17, owner: "why every time to set a username, I already
 * set"). Every browser starts with an anonymous account; when its wallet is then verified, the
 * wallet used to MOVE to that new, empty account — leaving the name, positions, chats and
 * groups behind on the old one, so a phone's home-screen app (its own storage) or a new browser
 * looked like a brand-new user. Proving the wallet's key is proof of who you are, so when the
 * wallet already belongs to an account and the current one is still empty, the session should
 * switch to the existing account instead. Returns that account's id, or null to keep the old
 * behaviour (the current account already has something of its own — never merge two real ones).
 */
export async function accountToResume(currentUserId: string, walletAddress: string): Promise<string | null> {
  const wallet = await prisma.wallet.findUnique({ where: { address: walletAddress }, select: { userId: true, verifiedAt: true } });
  if (!wallet?.userId || !wallet.verifiedAt || wallet.userId === currentUserId) return null;
  const [current, otherWallets, trades, solanaTrades] = await Promise.all([
    prisma.user.findUnique({ where: { id: currentUserId }, select: { username: true } }),
    prisma.wallet.count({ where: { userId: currentUserId, verifiedAt: { not: null } } }),
    prisma.tradeTransaction.count({ where: { userId: currentUserId } }),
    prisma.solanaTradeTransaction.count({ where: { userId: currentUserId } }),
  ]);
  const empty = !current?.username && otherWallets === 0 && trades === 0 && solanaTrades === 0;
  return empty ? wallet.userId : null;
}
