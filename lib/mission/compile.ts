import { randomBytes, randomUUID } from "node:crypto";

import {
  formatUnits,
  isAddress,
  keccak256,
  maxUint256,
  parseUnits,
  stringToHex,
  toHex,
  type Address,
  type Hex
} from "viem";

import { compileBaseUsdcToWethSwap } from "@/lib/composer/build-swap";
import { planMissionIntent } from "@/lib/agent/planner";
import { readStoredWalletMetadata } from "@/lib/dynamic/wallet-store";
import { readServerEnv, requireEnv } from "@/lib/env";
import { BASE_CHAIN_ID, BASE_TOKENS } from "@/lib/evm/tokens";
import {
  buildFlowApprovalTypedData,
  computeFlowHash
} from "@/lib/ledger/typed-data";
import type { CompileMissionInput, MissionView } from "@/lib/mission/types";
import type { MissionRecord } from "@/lib/mission/store";
import { evaluatePolicy } from "@/lib/policy/engine";
import type { PolicyInput } from "@/lib/policy/types";

const FLOW_TTL_SECONDS = 10 * 60;
const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

export const compileMission = async ({
  objective,
  amountUsdc
}: CompileMissionInput): Promise<MissionRecord> => {
  const env = readServerEnv();
  requireEnv(env, ["LIFI_API_KEY"]);

  const wallet = await readStoredWalletMetadata(
    env.DYNAMIC_WALLET_METADATA_PATH
  );
  if (!wallet || !isAddress(wallet.accountAddress)) {
    throw new Error("Dynamic wallet metadata is missing.");
  }

  const agentPlan = await planMissionIntent(
    { objective, amountUsdc },
    {
      LLM_API_KEY: env.LLM_API_KEY,
      LLM_BASE_URL: env.LLM_BASE_URL,
      LLM_MODEL: env.LLM_MODEL
    }
  );
  const amountAtomic = parseUnits(agentPlan.amountUsdc, 6);
  if (amountAtomic === 0n) {
    throw new Error("USDC amount must be greater than zero.");
  }

  const { result } = await compileBaseUsdcToWethSwap({
    apiKey: env.LIFI_API_KEY,
    baseUrl: env.LIFI_COMPOSER_BASE_URL,
    signer: wallet.accountAddress,
    amountAtomic: amountAtomic.toString()
  });

  if (result.status !== "success") {
    throw new Error(`Composer simulation failed: ${result.error.message}`);
  }

  const output = result.producedResources["swap.amountOut"];
  if (!output || output.kind !== "erc20" || !output.simulated) {
    throw new Error("Composer did not return a simulated WETH output.");
  }

  const transaction = result.transactionRequest;
  const transactionTo = transaction.to as Address;
  const calldata = transaction.data as Hex;
  const nowUnix = Math.floor(Date.now() / 1000);
  const expiresAtUnix = nowUnix + FLOW_TTL_SECONDS;
  const nonce = toHex(randomBytes(32));
  const flowHash = computeFlowHash({
    chainId: BigInt(BASE_CHAIN_ID),
    agentWallet: wallet.accountAddress,
    transactionTo,
    transactionValue: BigInt(transaction.value),
    calldata,
    expiresAt: BigInt(expiresAtUnix),
    nonce
  });

  const approvals = (result.approvals ?? []).map((approval) => ({
    token: approval.token as Address,
    spender: approval.spender as Address,
    amount: BigInt(approval.amount),
    isUnlimited: BigInt(approval.amount) === maxUint256
  }));
  const policyInput: PolicyInput = {
    chainId: BASE_CHAIN_ID,
    action: "SWAP",
    amountUsdcAtomic: amountAtomic,
    maxSlippageBps: 100,
    simulatedPriceImpactBps: result.priceImpact?.impactBps,
    simulationSucceeded: true,
    signer: wallet.accountAddress,
    expectedSigner: wallet.accountAddress,
    target: transactionTo,
    allowedTargets: [result.userProxy as Address],
    tokens: [BASE_TOKENS.USDC, BASE_TOKENS.WETH],
    allowedTokens: [BASE_TOKENS.USDC, BASE_TOKENS.WETH],
    approvals,
    hasExpectedMinimumOutput: BigInt(output.simulated.amountOutMin) > 0n,
    compiledAtUnix: nowUnix,
    expiresAtUnix,
    nowUnix,
    transactionHashBeforePolicy: flowHash,
    transactionHashAtExecution: flowHash
  };
  const decision = evaluatePolicy(policyInput);
  const riskDigest = keccak256(stringToHex(JSON.stringify(decision)));
  const formattedAmount = formatUnits(amountAtomic, 6);
  const minimumOutput = formatUnits(
    BigInt(output.simulated.amountOutMin),
    18
  );

  console.info(
    `[LI.FI] COMPILED | ${formattedAmount} USDC → WETH | atomic | strict simulation | target ${compact(transactionTo)}`
  );
  console.info(
    `[POLICY] ${decision.outcome} | risk ${decision.riskScore} | exact approval | flow ${compact(flowHash)}`
  );
  console.info(
    decision.outcome === "BLOCKED"
      ? "[DYNAMIC] SKIPPED | policy blocked before signing"
      : decision.outcome === "LEDGER_REQUIRED"
        ? `[DYNAMIC] WAITING | Ledger approval required | signer ${compact(wallet.accountAddress)}`
        : `[DYNAMIC] READY | signer ${compact(wallet.accountAddress)} | ${approvals.length + 1} planned tx`
  );

  // Constructing this here keeps the approval contract in sync with the UI
  // payload even before a physical Ledger provider is connected.
  buildFlowApprovalTypedData({
    intent: `Swap ${formattedAmount} USDC for WETH`,
    minimumReceived: `${minimumOutput} WETH`,
    network: "Base mainnet",
    flowHash,
    agentWallet: wallet.accountAddress,
    transactionTo,
    transactionValue: BigInt(transaction.value),
    calldataHash: keccak256(calldata),
    riskDigest,
    expiresAt: BigInt(expiresAtUnix),
    nonce
  });

  const view: MissionView = {
    id: randomUUID(),
    state: decision.outcome,
    objective,
    action: "SWAP",
    amountUsdc: formattedAmount,
    agentPlan,
    agentWallet: wallet.accountAddress,
    plan: [],
    simulation: {
      outputWeth: formatUnits(BigInt(output.simulated.amountOut), 18),
      minimumOutputWeth: minimumOutput,
      priceImpactBps: result.priceImpact?.impactBps ?? null,
      gasLimit: transaction.gasLimit ?? null,
      approvalCount: approvals.length,
      approvalMode: approvals.length === 0 ? "NONE" : "EXACT",
      transactionTarget: transactionTo
    },
    composer: {
      flowName: "circuitbreaker-base-usdc-to-weth",
      executionModel: "ATOMIC_SINGLE_TRANSACTION",
      steps: [
        {
          id: "fund",
          operation: "Direct materialisation",
          detail: `${formattedAmount} USDC enters the signer-specific Composer proxy`,
          enforcement: "COMPOSER"
        },
        {
          id: "swap",
          operation: "lifi.swap",
          detail: "USDC is swapped to WETH with a 100 bps slippage ceiling",
          enforcement: "COMPOSER"
        },
        {
          id: "guard",
          operation: "Simulation and minimum output",
          detail: `${minimumOutput} WETH minimum`,
          enforcement: "CIRCUITBREAKER"
        },
        {
          id: "sweep",
          operation: "Terminal sweep",
          detail: "Remaining WETH is swept back to the Dynamic agent wallet",
          enforcement: "COMPOSER"
        }
      ]
    },
    decision,
    approval: {
      flowHash,
      calldataHash: keccak256(calldata),
      riskDigest,
      expiresAtUnix,
      nonce
    },
    createdAt: new Date(nowUnix * 1000).toISOString()
  };

  return {
    view,
    policyInput,
    transaction: {
      to: transactionTo,
      data: calldata,
      value: BigInt(transaction.value),
      gasLimit: transaction.gasLimit
        ? BigInt(transaction.gasLimit)
        : undefined
    },
    approvals: (result.approvals ?? []).map((approval) => ({
      to: approval.transactionRequest.to as Address,
      data: approval.transactionRequest.data as Hex,
      value: BigInt(approval.transactionRequest.value)
    }))
  };
};
