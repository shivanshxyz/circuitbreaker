import type { Address } from "viem";

import { buildFlowApprovalTypedData } from "@/lib/ledger/typed-data";
import type { MissionRecord } from "@/lib/mission/store";

export const buildMissionApprovalTypedData = (mission: MissionRecord) =>
  buildFlowApprovalTypedData({
    intent: `Swap ${mission.view.amountUsdc} USDC for WETH`,
    minimumReceived: `${mission.view.simulation.minimumOutputWeth} WETH`,
    network: "Base mainnet",
    flowHash: mission.view.approval.flowHash,
    agentWallet: mission.view.agentWallet,
    transactionTo: mission.transaction.to,
    transactionValue: mission.transaction.value,
    calldataHash: mission.view.approval.calldataHash,
    riskDigest: mission.view.approval.riskDigest,
    expiresAt: BigInt(mission.view.approval.expiresAtUnix),
    nonce: mission.view.approval.nonce
  });

export const SIMULATOR_APPROVER =
  "0x17c5185167401ed00cf5f5b2fc97d9bbfdb7d025" as Address;
