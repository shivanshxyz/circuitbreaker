import { materialisers, resources } from "@lifi/composer-sdk";
import type { Address } from "viem";

import { BASE_CHAIN_ID, BASE_TOKENS } from "@/lib/evm/tokens";
import { createCircuitBreakerComposeSdk } from "@/lib/composer/client";

export const compileBaseUsdcToWethSwap = async ({
  apiKey,
  baseUrl,
  signer,
  amountAtomic
}: {
  apiKey: string;
  baseUrl: string;
  signer: Address;
  amountAtomic: string;
}) => {
  const sdk = createCircuitBreakerComposeSdk({ apiKey, baseUrl });
  const builder = sdk.flow(BASE_CHAIN_ID, {
    name: "circuitbreaker-base-usdc-to-weth",
    inputs: {
      amountIn: resources.erc20(BASE_TOKENS.USDC, BASE_CHAIN_ID)
    }
  });

  builder.lifi.swap("swap", {
    bind: {
      amountIn: builder.inputs.amountIn
    },
    config: {
      resourceOut: resources.erc20(BASE_TOKENS.WETH, BASE_CHAIN_ID),
      slippage: 0.01
    }
  });

  const flow = builder.build();
  const request = sdk.request(flow, {
    signer,
    simulationPolicy: "strict",
    maxPriceImpactBps: 100,
    inputs: {
      amountIn: materialisers.directDeposit({
        amount: BigInt(amountAtomic)
      })
    },
    sweepTo: builder.context.sender
  });
  const result = await sdk.client.compile(request);

  return {
    flow,
    request,
    result
  };
};
