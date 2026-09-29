import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SolanaQuoteDto } from './solana-quote.dto';

const base = {
  side: 'BUY',
  tokenMint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  walletAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

async function amountErrors(amount: unknown): Promise<string[]> {
  const errors = await validate(plainToInstance(SolanaQuoteDto, { ...base, amount }));
  return errors.filter((e) => e.property === 'amount').flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('SolanaQuoteDto amount', () => {
  it('accepts raw integer units', async () => {
    expect(await amountErrors('5000000')).toEqual([]);
  });

  it.each(['0.05', '5.0', '0', '007', '-5', '', '1e6'])('rejects %p instead of forwarding it to Jupiter', async (amount) => {
    expect(await amountErrors(amount)).not.toEqual([]);
  });
});
