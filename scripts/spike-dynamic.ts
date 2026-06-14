import { ThresholdSignatureScheme } from "@dynamic-labs-wallet/core";
import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { readServerEnv, requireEnv } from "@/lib/env";

type WalletMetadata = Awaited<
  ReturnType<DynamicEvmWalletClient["createWalletAccount"]>
>["walletMetadata"];

const env = readServerEnv();
requireEnv(env, [
  "DYNAMIC_AUTH_TOKEN",
  "DYNAMIC_ENVIRONMENT_ID",
  "DYNAMIC_WALLET_PASSWORD"
]);

const metadataPath = env.DYNAMIC_WALLET_METADATA_PATH;
const client = new DynamicEvmWalletClient({
  environmentId: env.DYNAMIC_ENVIRONMENT_ID,
  enableMPCAccelerator: false
});
await client.authenticateApiToken(env.DYNAMIC_AUTH_TOKEN);

const loadWalletMetadata = async (): Promise<WalletMetadata | null> => {
  try {
    return JSON.parse(await readFile(metadataPath, "utf8")) as WalletMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

let walletMetadata = await loadWalletMetadata();
let created = false;

if (!walletMetadata) {
  const wallet = await client.createWalletAccount({
    thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
    password: env.DYNAMIC_WALLET_PASSWORD,
    backUpToDynamic: true,
    onError: (error: Error) => {
      throw error;
    }
  });

  walletMetadata = wallet.walletMetadata;
  created = true;
  await mkdir(dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, JSON.stringify(walletMetadata, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
}

const signature = await client.signMessage({
  walletMetadata,
  message: "CircuitBreaker Dynamic integration spike",
  password: env.DYNAMIC_WALLET_PASSWORD
});

process.stdout.write(
  `${JSON.stringify(
    {
      accountAddress: walletMetadata.accountAddress,
      created,
      metadataPath,
      messageSigned: true,
      signature
    },
    null,
    2
  )}\n`
);
