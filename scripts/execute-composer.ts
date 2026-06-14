import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import {
  createPublicClient,
  formatEther,
  formatUnits,
  http,
  isAddress,
  maxUint256,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";

import { compileBaseUsdcToWethSwap } from "@/lib/composer/build-swap";
import { createAuthenticatedDynamicClient } from "@/lib/dynamic/client";
import { signBroadcastAndWait } from "@/lib/dynamic/executor";
import { readStoredWalletMetadata } from "@/lib/dynamic/wallet-store";
import { readServerEnv, requireEnv } from "@/lib/env";
import { BASE_TOKENS } from "@/lib/evm/tokens";

type DynamicWalletMetadata = Parameters<
  DynamicEvmWalletClient["signTransaction"]
>[0]["walletMetadata"];

const shouldExecute = process.argv.includes("--execute");
const amountAtomic = 100_000n;

const env = readServerEnv();
requireEnv(env, [
  "LIFI_API_KEY",
  "DYNAMIC_AUTH_TOKEN",
  "DYNAMIC_ENVIRONMENT_ID",
  "DYNAMIC_WALLET_PASSWORD"
]);

const storedMetadata = await readStoredWalletMetadata(
  env.DYNAMIC_WALLET_METADATA_PATH
);
if (!storedMetadata || !isAddress(storedMetadata.accountAddress)) {
  throw new Error("Dynamic wallet metadata is missing. Run pnpm spike:dynamic.");
}
const walletMetadata = storedMetadata as DynamicWalletMetadata;
const account = walletMetadata.accountAddress as Address;

const publicClient = createPublicClient({
  chain: base,
  transport: http(env.BASE_RPC_URL)
});
const balanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
] as const;

const [ethBalance, usdcBalance] = await Promise.all([
  publicClient.getBalance({ address: account }),
  publicClient.readContract({
    address: BASE_TOKENS.USDC,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [account]
  })
]);
const { result } = await compileBaseUsdcToWethSwap({
  apiKey: env.LIFI_API_KEY,
  baseUrl: env.LIFI_COMPOSER_BASE_URL,
  signer: account,
  amountAtomic: amountAtomic.toString()
});

if (result.status !== "success") {
  throw new Error(`Composer returned partial status: ${result.error.message}`);
}
const approvals = result.approvals ?? [];

for (const approval of approvals) {
  if (BigInt(approval.amount) === maxUint256) {
    throw new Error("Composer requested an unlimited approval; refusing.");
  }
  if (BigInt(approval.amount) > amountAtomic) {
    throw new Error("Composer approval exceeds the intended input amount.");
  }
}

process.stdout.write(
  `${JSON.stringify(
    {
      mode: shouldExecute ? "EXECUTE" : "DRY_RUN",
      chain: "Base mainnet",
      account,
      balances: {
        eth: formatEther(ethBalance),
        usdc: formatUnits(usdcBalance, 6)
      },
      inputUsdc: formatUnits(amountAtomic, 6),
      approvals: approvals.map((approval) => ({
        token: approval.token,
        spender: approval.spender,
        amount: approval.amount
      })),
      transaction: {
        to: result.transactionRequest.to,
        value: result.transactionRequest.value,
        calldataBytes: (result.transactionRequest.data.length - 2) / 2,
        gasLimit: result.transactionRequest.gasLimit ?? null
      },
      priceImpactBps: result.priceImpact?.impactBps ?? null
    },
    null,
    2
  )}\n`
);

if (!shouldExecute) {
  process.stdout.write(
    "Dry run complete. Broadcast requires: pnpm execute:composer -- --execute\n"
  );
  process.exit(0);
}
if (usdcBalance < amountAtomic) {
  throw new Error(
    `Insufficient USDC. Need ${formatUnits(amountAtomic, 6)}, have ${formatUnits(
      usdcBalance,
      6
    )}.`
  );
}
if (ethBalance === 0n) {
  throw new Error("Insufficient ETH for Base gas.");
}

const dynamicClient = await createAuthenticatedDynamicClient({
  environmentId: env.DYNAMIC_ENVIRONMENT_ID,
  authToken: env.DYNAMIC_AUTH_TOKEN
});
let nonce = await publicClient.getTransactionCount({
  address: account,
  blockTag: "pending"
});
const receipts: Array<{
  kind: "approval" | "composer";
  hash: Hex;
  status: "success" | "reverted";
}> = [];

for (const approval of approvals) {
  const receipt = await signBroadcastAndWait({
    dynamicClient,
    walletMetadata,
    password: env.DYNAMIC_WALLET_PASSWORD,
    rpcUrl: env.BASE_RPC_URL,
    nonce,
    transaction: {
      to: approval.transactionRequest.to as Address,
      data: approval.transactionRequest.data as Hex,
      value: BigInt(approval.transactionRequest.value)
    }
  });
  if (receipt.status !== "success") {
    throw new Error(`Approval reverted: ${receipt.transactionHash}`);
  }
  receipts.push({
    kind: "approval",
    hash: receipt.transactionHash,
    status: receipt.status
  });
  nonce += 1;
}

const flowReceipt = await signBroadcastAndWait({
  dynamicClient,
  walletMetadata,
  password: env.DYNAMIC_WALLET_PASSWORD,
  rpcUrl: env.BASE_RPC_URL,
  nonce,
  transaction: {
    to: result.transactionRequest.to as Address,
    data: result.transactionRequest.data as Hex,
    value: BigInt(result.transactionRequest.value),
    gasLimit: result.transactionRequest.gasLimit
      ? BigInt(result.transactionRequest.gasLimit)
      : undefined
  }
});
if (flowReceipt.status !== "success") {
  throw new Error(`Composer flow reverted: ${flowReceipt.transactionHash}`);
}
receipts.push({
  kind: "composer",
  hash: flowReceipt.transactionHash,
  status: flowReceipt.status
});

process.stdout.write(`${JSON.stringify({ receipts }, null, 2)}\n`);
