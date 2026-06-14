import { z } from "zod";

import type { PolicyDecision } from "@/lib/policy/types";
import type { AgentPlan } from "@/lib/agent/planner";

export const compileMissionSchema = z.object({
  objective: z.string().trim().min(8).max(240),
  amountUsdc: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/, "Use a valid USDC amount.")
});

export type CompileMissionInput = z.infer<typeof compileMissionSchema>;

export type MissionState =
  | "COMPILED"
  | "AUTO_APPROVED"
  | "LEDGER_REQUIRED"
  | "BLOCKED"
  | "LEDGER_APPROVED"
  | "EXECUTED";

export type MissionView = {
  id: string;
  state: MissionState;
  objective: string;
  action: "SWAP";
  amountUsdc: string;
  agentPlan: AgentPlan;
  agentWallet: `0x${string}`;
  plan: readonly string[];
  simulation: {
    outputWeth: string;
    minimumOutputWeth: string;
    priceImpactBps: number | null;
    gasLimit: string | null;
    approvalCount: number;
    approvalMode: "NONE" | "EXACT";
    transactionTarget: `0x${string}`;
  };
  composer: {
    flowName: string;
    executionModel: "ATOMIC_SINGLE_TRANSACTION";
    steps: readonly {
      id: string;
      operation: string;
      detail: string;
      enforcement: "COMPOSER" | "CIRCUITBREAKER";
    }[];
  };
  decision: PolicyDecision;
  approval: {
    flowHash: `0x${string}`;
    calldataHash: `0x${string}`;
    riskDigest: `0x${string}`;
    expiresAtUnix: number;
    nonce: `0x${string}`;
    approvedBy?: `0x${string}`;
  };
  execution?: {
    transactionHashes: readonly `0x${string}`[];
  };
  createdAt: string;
};
