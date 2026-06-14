import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildFlowApprovalTypedData,
  computeFlowHash,
  flowApprovalTypes
} from "@/lib/ledger/typed-data";

const args = {
  chainId: 8453n,
  agentWallet: "0x1111111111111111111111111111111111111111",
  transactionTo: "0x2222222222222222222222222222222222222222",
  transactionValue: 0n,
  calldata: "0x1234",
  expiresAt: 1_800_000_000n,
  nonce: `0x${"ab".repeat(32)}`
} as const;

describe("computeFlowHash", () => {
  it("is deterministic", () => {
    expect(computeFlowHash(args)).toBe(computeFlowHash(args));
  });

  it("changes when calldata changes", () => {
    expect(computeFlowHash(args)).not.toBe(
      computeFlowHash({ ...args, calldata: "0x1235" })
    );
  });

  it("changes when the agent wallet changes", () => {
    expect(computeFlowHash(args)).not.toBe(
      computeFlowHash({
        ...args,
        agentWallet: "0x3333333333333333333333333333333333333333"
      })
    );
  });
});

describe("buildFlowApprovalTypedData", () => {
  it("puts human-readable mission fields before cryptographic commitments", () => {
    const typedData = buildFlowApprovalTypedData({
      intent: "Swap 5 USDC for WETH",
      minimumReceived: "0.002 WETH",
      network: "Base mainnet",
      flowHash: `0x${"11".repeat(32)}`,
      agentWallet: args.agentWallet,
      transactionTo: args.transactionTo,
      transactionValue: 0n,
      calldataHash: `0x${"22".repeat(32)}`,
      riskDigest: `0x${"33".repeat(32)}`,
      expiresAt: args.expiresAt,
      nonce: args.nonce
    });

    expect(typedData.types.FlowApproval.slice(0, 3)).toEqual([
      { name: "intent", type: "string" },
      { name: "minimumReceived", type: "string" },
      { name: "network", type: "string" }
    ]);
    expect(typedData.message.intent).toBe("Swap 5 USDC for WETH");
  });

  it("stays aligned with the ERC-7730 Clear Signing schema", () => {
    const metadata = JSON.parse(
      readFileSync(
        new URL(
          "../../ledger/erc7730/eip712-circuitbreaker-approval.json",
          import.meta.url
        ),
        "utf8"
      )
    ) as {
      context: {
        eip712: {
          deployments: { chainId: number; address: string }[];
          domain: { name: string; version: string; chainId: number };
          schemas: {
            primaryType: string;
            types: {
              FlowApproval: readonly { name: string; type: string }[];
            };
          }[];
        };
      };
    };
    const context = metadata.context.eip712;

    expect(context.domain).toEqual({
      name: "CircuitBreaker",
      version: "1",
      chainId: 8453
    });
    expect(context.deployments).toEqual([
      {
        chainId: 8453,
        address: "0x0000000000000000000000000000000000000000"
      }
    ]);
    expect(context.schemas[0]?.primaryType).toBe("FlowApproval");
    expect(context.schemas[0]?.types.FlowApproval).toEqual(
      flowApprovalTypes.FlowApproval
    );
  });
});
