import type { Address } from "viem";

export const BASE_CHAIN_ID = 8453 as const;

export const BASE_TOKENS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Address,
  WETH: "0x4200000000000000000000000000000000000006" as Address
} as const;
