import { formatUnits, isAddress, keccak256, type Hex } from "viem";

import { compileBaseUsdcToWethSwap } from "@/lib/composer/build-swap";
import { readStoredWalletMetadata } from "@/lib/dynamic/wallet-store";
import { readServerEnv, requireEnv } from "@/lib/env";

const env = readServerEnv();
requireEnv(env, ["LIFI_API_KEY"]);

const storedWallet = await readStoredWalletMetadata(
  env.DYNAMIC_WALLET_METADATA_PATH
);
const signer = storedWallet?.accountAddress ?? env.COMPOSER_SIGNER_ADDRESS;

if (!signer || !isAddress(signer)) {
  throw new Error(
    "No valid signer found. Run pnpm spike:dynamic or set COMPOSER_SIGNER_ADDRESS."
  );
}

const amountAtomic = "1000000";
const { flow, request, result } = await compileBaseUsdcToWethSwap({
  apiKey: env.LIFI_API_KEY,
  baseUrl: env.LIFI_COMPOSER_BASE_URL,
  signer,
  amountAtomic
});

const transaction = result.transactionRequest;
const summary = {
  input: `${formatUnits(BigInt(amountAtomic), 6)} USDC`,
  status: result.status,
  flowId: flow.id,
  chainId: flow.chainId,
  signer: request.run.signer,
  userProxy: result.userProxy,
  transaction: {
    to: transaction.to,
    value: transaction.value,
    calldataBytes: (transaction.data.length - 2) / 2,
    calldataHash: keccak256(transaction.data as Hex)
  },
  approvals: result.approvals ?? [],
  priceImpact: result.status === "success" ? result.priceImpact ?? null : null,
  producedResources: result.producedResources
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
