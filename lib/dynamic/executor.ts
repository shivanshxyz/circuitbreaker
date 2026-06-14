import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type TransactionReceipt
} from "viem";
import { base } from "viem/chains";

type WalletMetadata = Parameters<
  DynamicEvmWalletClient["signTransaction"]
>[0]["walletMetadata"];

export type ExecutableTransaction = {
  to: Address;
  data: Hex;
  value: bigint;
  gasLimit?: bigint;
};

export const signBroadcastAndWait = async ({
  dynamicClient,
  walletMetadata,
  password,
  rpcUrl,
  transaction,
  nonce
}: {
  dynamicClient: DynamicEvmWalletClient;
  walletMetadata: WalletMetadata;
  password: string;
  rpcUrl: string;
  transaction: ExecutableTransaction;
  nonce?: number;
}): Promise<TransactionReceipt> => {
  const account = walletMetadata.accountAddress as Address;
  const publicClient = createPublicClient({
    chain: base,
    transport: http(rpcUrl)
  });
  const prepared = await publicClient.prepareTransactionRequest({
    account,
    chain: base,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
    gas: transaction.gasLimit,
    nonce
  });

  const signed = await dynamicClient.signTransaction({
    walletMetadata,
    password,
    transaction: prepared as unknown as Parameters<
      DynamicEvmWalletClient["signTransaction"]
    >[0]["transaction"]
  });
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(rpcUrl)
  });
  const hash = await walletClient.sendRawTransaction({
    serializedTransaction: signed as Hex
  });
  return publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 1,
    timeout: 120_000
  });
};
