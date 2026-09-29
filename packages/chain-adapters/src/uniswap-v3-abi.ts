/** The minimal read-only slice of a Uniswap-V3-style pool this package needs. */
export const uniswapV3PoolAbi = [
  {
    type: 'function',
    name: 'slot0',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'fee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint24' }] },
  { type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint128' }] },
] as const;

export const uniswapV3SwapEvent = {
  type: 'event',
  name: 'Swap',
  inputs: [
    { name: 'sender', type: 'address', indexed: true },
    { name: 'recipient', type: 'address', indexed: true },
    { name: 'amount0', type: 'int256', indexed: false },
    { name: 'amount1', type: 'int256', indexed: false },
    { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
    { name: 'liquidity', type: 'uint128', indexed: false },
    { name: 'tick', type: 'int24', indexed: false },
  ],
} as const;

/** PancakeSwap V3's Swap — identical to Uniswap's plus two trailing protocol-fee fields,
 *  which gives it a different topic0 (0x19b47279… vs Uniswap's 0xc42079f9…). Filtering on
 *  Uniswap's event alone matched zero swaps on every BNB pool, confirmed 2026-09-29: one
 *  WBNB pool emitted 135 of these in ~2.5 minutes while Kamby had recorded none, ever. Every
 *  field Kamby reads is in the same position in both. */
export const pancakeV3SwapEvent = {
  type: 'event',
  name: 'Swap',
  inputs: [
    ...uniswapV3SwapEvent.inputs,
    { name: 'protocolFeesToken0', type: 'uint128', indexed: false },
    { name: 'protocolFeesToken1', type: 'uint128', indexed: false },
  ],
} as const;

/** Emitted by the Factory contract (not a pool itself) whenever a new pool is deployed —
 *  see pool-discovery.ts in apps/workers for the only consumer. */
export const uniswapV3PoolCreatedEvent = {
  type: 'event',
  name: 'PoolCreated',
  inputs: [
    { name: 'token0', type: 'address', indexed: true },
    { name: 'token1', type: 'address', indexed: true },
    { name: 'fee', type: 'uint24', indexed: true },
    { name: 'tickSpacing', type: 'int24', indexed: false },
    { name: 'pool', type: 'address', indexed: false },
  ],
} as const;

export const erc20ExtraAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;
