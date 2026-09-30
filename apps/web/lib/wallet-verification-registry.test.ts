import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claimAutoAttempt, isVerified, onVerified, resetWalletVerificationRegistry, verifyOnce } from './wallet-verification-registry';

describe('wallet verification registry', () => {
  beforeEach(() => resetWalletVerificationRegistry());

  it('runs one verification per wallet even when several hooks ask at once', async () => {
    const sign = vi.fn().mockResolvedValue(undefined);
    await Promise.all([verifyOnce('evm:0xabc', sign), verifyOnce('evm:0xabc', sign), verifyOnce('evm:0xabc', sign)]);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(isVerified('evm:0xabc')).toBe(true);
  });

  it('tells every listening hook the moment a wallet is verified', async () => {
    const heard: string[] = [];
    onVerified((key) => heard.push(key));
    await verifyOnce('solana:Abc', async () => {});

    expect(heard).toEqual(['solana:Abc']);
  });

  it('does not mark a wallet verified when signing fails, and allows a retry', async () => {
    await expect(verifyOnce('evm:0xabc', () => Promise.reject(new Error('declined')))).rejects.toThrow('declined');
    expect(isVerified('evm:0xabc')).toBe(false);

    await verifyOnce('evm:0xabc', async () => {});
    expect(isVerified('evm:0xabc')).toBe(true);
  });

  it('grants the automatic attempt only once per wallet per page load', () => {
    expect(claimAutoAttempt('evm:0xabc')).toBe(true);
    expect(claimAutoAttempt('evm:0xabc')).toBe(false);
    expect(claimAutoAttempt('evm:0xdef')).toBe(true);
  });
});
