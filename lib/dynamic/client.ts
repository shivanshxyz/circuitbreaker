import { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";

export const createAuthenticatedDynamicClient = async ({
  environmentId,
  authToken
}: {
  environmentId: string;
  authToken: string;
}) => {
  const client = new DynamicEvmWalletClient({
    environmentId,
    enableMPCAccelerator: false
  });
  await client.authenticateApiToken(authToken);
  return client;
};
