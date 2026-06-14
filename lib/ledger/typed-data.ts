import {
  encodeAbiParameters,
  keccak256,
  stringToHex,
  type Address,
  type Hex
} from "viem";

export const CIRCUITBREAKER_POLICY_VERSION = "circuitbreaker-v1" as const;

export type FlowApproval = {
  intent: string;
  minimumReceived: string;
  network: string;
  flowHash: Hex;
  agentWallet: Address;
  transactionTo: Address;
  transactionValue: bigint;
  calldataHash: Hex;
  riskDigest: Hex;
  expiresAt: bigint;
  nonce: Hex;
};

export const computeFlowHash = ({
  chainId,
  agentWallet,
  transactionTo,
  transactionValue,
  calldata,
  expiresAt,
  nonce
}: {
  chainId: bigint;
  agentWallet: Address;
  transactionTo: Address;
  transactionValue: bigint;
  calldata: Hex;
  expiresAt: bigint;
  nonce: Hex;
}) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" }
      ],
      [
        chainId,
        agentWallet,
        transactionTo,
        transactionValue,
        keccak256(calldata),
        keccak256(stringToHex(CIRCUITBREAKER_POLICY_VERSION)),
        expiresAt,
        nonce
      ]
    )
  );

export const flowApprovalTypes = {
  FlowApproval: [
    { name: "intent", type: "string" },
    { name: "minimumReceived", type: "string" },
    { name: "network", type: "string" },
    { name: "flowHash", type: "bytes32" },
    { name: "agentWallet", type: "address" },
    { name: "transactionTo", type: "address" },
    { name: "transactionValue", type: "uint256" },
    { name: "calldataHash", type: "bytes32" },
    { name: "riskDigest", type: "bytes32" },
    { name: "expiresAt", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
} as const;

export const buildFlowApprovalTypedData = (approval: FlowApproval) => ({
  domain: {
    name: "CircuitBreaker",
    version: "1",
    chainId: 8453
  },
  primaryType: "FlowApproval" as const,
  types: flowApprovalTypes,
  message: approval
});
