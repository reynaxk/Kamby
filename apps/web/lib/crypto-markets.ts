import type { CryptoMajor } from '@kamby/domain';

/**
 * Where each Crypto-tab major trades on Kamby — one of the vetted seed-list markets (see
 * packages/domain/src/seed-markets.ts), or the Solana trade page for SOL. BTC trades as
 * Coinbase's cbBTC on Base; AVAX, XRP, DOGE, DOT and UNI as their Binance-Peg tokens on BNB Chain.
 */
export const CRYPTO_TRADE_TARGETS: Record<CryptoMajor, { chainIdentifier: string; tokenAddress: string; href: string; label: string }> = {
  BTC: { chainIdentifier: 'eip155:8453', tokenAddress: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', href: '/market/base/0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', label: 'Bitcoin · cbBTC on Base' },
  ETH: { chainIdentifier: 'eip155:8453', tokenAddress: '0x4200000000000000000000000000000000000006', href: '/market/base/0x4200000000000000000000000000000000000006', label: 'Ethereum · WETH on Base' },
  SOL: { chainIdentifier: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112', href: '/solana', label: 'Solana' },
  BNB: { chainIdentifier: 'eip155:56', tokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', href: '/market/bnb/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', label: 'BNB · WBNB on BNB Chain' },
  XRP: { chainIdentifier: 'eip155:56', tokenAddress: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', href: '/market/bnb/0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', label: 'XRP · on BNB Chain' },
  DOGE: { chainIdentifier: 'eip155:56', tokenAddress: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', href: '/market/bnb/0xbA2aE424d960c26247Dd6c32edC70B295c744C43', label: 'Dogecoin · on BNB Chain' },
  DOT: { chainIdentifier: 'eip155:56', tokenAddress: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', href: '/market/bnb/0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', label: 'Polkadot · on BNB Chain' },
  UNI: { chainIdentifier: 'eip155:56', tokenAddress: '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', href: '/market/bnb/0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', label: 'Uniswap · on BNB Chain' },
  AVAX: { chainIdentifier: 'eip155:56', tokenAddress: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', href: '/market/bnb/0x1CE0c2827e2eF14D5C4f29a091d735A204794041', label: 'Avalanche · AVAX on BNB Chain' },
};
