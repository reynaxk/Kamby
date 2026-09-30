import type { CryptoMajor } from '@kamby/domain';

/**
 * Where each Crypto-tab major trades on Kamby — one of the vetted seed-list markets (see
 * packages/domain/src/seed-markets.ts), or the Solana trade page for SOL. BTC trades as
 * Coinbase's cbBTC on Base, AVAX as Binance-Peg AVAX on BNB Chain.
 */
export const CRYPTO_TRADE_TARGETS: Record<CryptoMajor, { chainIdentifier: string; tokenAddress: string; href: string; label: string }> = {
  BTC: { chainIdentifier: 'eip155:8453', tokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', href: '/market/base/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', label: 'Bitcoin · cbBTC on Base' },
  ETH: { chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006', href: '/market/base/0x4200000000000000000000000000000000000006', label: 'Ethereum · WETH on Base' },
  SOL: { chainIdentifier: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112', href: '/solana', label: 'Solana' },
  BNB: { chainIdentifier: 'eip155:56', tokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', href: '/market/bnb/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', label: 'BNB · WBNB on BNB Chain' },
  AVAX: { chainIdentifier: 'eip155:56', tokenAddress: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', href: '/market/bnb/0x1CE0c2827e2eF14D5C4f29a091d735A204794041', label: 'Avalanche · AVAX on BNB Chain' },
};
