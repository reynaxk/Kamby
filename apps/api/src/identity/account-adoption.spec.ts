import { prisma } from '@kamby/db';
import { accountToResume } from './account-adoption';

jest.mock('@kamby/db', () => ({
  prisma: {
    wallet: { findUnique: jest.fn(), count: jest.fn() },
    user: { findUnique: jest.fn() },
    tradeTransaction: { count: jest.fn() },
    solanaTradeTransaction: { count: jest.fn() },
  },
}));

const db = prisma as unknown as {
  wallet: { findUnique: jest.Mock; count: jest.Mock };
  user: { findUnique: jest.Mock };
  tradeTransaction: { count: jest.Mock };
  solanaTradeTransaction: { count: jest.Mock };
};

function setup({ owner = 'old-user', username = null as string | null, wallets = 0, trades = 0 } = {}) {
  db.wallet.findUnique.mockResolvedValue(owner ? { userId: owner, verifiedAt: new Date() } : null);
  db.user.findUnique.mockResolvedValue({ username });
  db.wallet.count.mockResolvedValue(wallets);
  db.tradeTransaction.count.mockResolvedValue(trades);
  db.solanaTradeTransaction.count.mockResolvedValue(0);
}

describe('accountToResume', () => {
  it('resumes the wallet’s existing account when this session’s account is still empty', async () => {
    setup();
    await expect(accountToResume('new-user', '0xabc')).resolves.toBe('old-user');
  });

  it('never merges two real accounts — a session with its own name, wallet or trades keeps the old behaviour', async () => {
    setup({ username: 'sandy' });
    await expect(accountToResume('new-user', '0xabc')).resolves.toBeNull();
    setup({ wallets: 1 });
    await expect(accountToResume('new-user', '0xabc')).resolves.toBeNull();
    setup({ trades: 2 });
    await expect(accountToResume('new-user', '0xabc')).resolves.toBeNull();
  });

  it('does nothing for a wallet nobody owns yet, or one this account already owns', async () => {
    setup({ owner: '' });
    await expect(accountToResume('new-user', '0xabc')).resolves.toBeNull();
    setup({ owner: 'new-user' });
    await expect(accountToResume('new-user', '0xabc')).resolves.toBeNull();
  });
});
