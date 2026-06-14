import type {
  PolicyDecision,
  PolicyInput,
  PolicyReason
} from "@/lib/policy/types";
import { policyInputSchema } from "@/lib/policy/types";

const USDC_ATOMIC = 1_000_000n;
export const AUTO_LIMIT = 1n * USDC_ATOMIC / 100n;
export const ABSOLUTE_LIMIT = 10n * USDC_ATOMIC;
export const MAX_SLIPPAGE_BPS = 100;

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

const inAddressList = (address: string, allowed: readonly string[]) =>
  allowed.some((candidate) => sameAddress(candidate, address));

export const evaluatePolicy = (rawInput: PolicyInput): PolicyDecision => {
  const input = policyInputSchema.parse(rawInput);
  const reasons: PolicyReason[] = [];

  const block = (rule: string, message: string) => {
    reasons.push({ rule, severity: "BLOCK", message });
  };
  const escalate = (rule: string, message: string) => {
    reasons.push({ rule, severity: "ESCALATE", message });
  };

  if (input.chainId !== 8453) {
    block("CHAIN_ALLOWLIST", "Only Base mainnet is allowed.");
  }
  if (input.amountUsdcAtomic > ABSOLUTE_LIMIT) {
    block("ABSOLUTE_SPEND_LIMIT", "Amount exceeds the 10 USDC hard limit.");
  }
  if (input.maxSlippageBps > MAX_SLIPPAGE_BPS) {
    block("SLIPPAGE_LIMIT", "Requested slippage exceeds 100 basis points.");
  }
  if (
    input.simulatedPriceImpactBps !== undefined &&
    input.simulatedPriceImpactBps > MAX_SLIPPAGE_BPS
  ) {
    block("PRICE_IMPACT_LIMIT", "Simulated price impact exceeds 100 basis points.");
  }
  if (!input.simulationSucceeded) {
    block("SIMULATION_REQUIRED", "Composer simulation did not succeed.");
  }
  if (!sameAddress(input.signer, input.expectedSigner)) {
    block("SIGNER_BINDING", "Compiled signer differs from the agent wallet.");
  }
  if (!inAddressList(input.target, input.allowedTargets)) {
    block("TARGET_ALLOWLIST", "Transaction target is not allowlisted.");
  }
  if (input.tokens.some((token) => !inAddressList(token, input.allowedTokens))) {
    block("TOKEN_ALLOWLIST", "Flow contains an unapproved token.");
  }
  if (input.approvals.some((approval) => approval.isUnlimited)) {
    block("UNLIMITED_APPROVAL", "Unlimited token approvals are forbidden.");
  }
  if (!input.hasExpectedMinimumOutput) {
    block("MINIMUM_OUTPUT", "The flow has no enforceable minimum output.");
  }
  if (input.nowUnix >= input.expiresAtUnix) {
    block("FLOW_EXPIRY", "The compiled flow has expired.");
  }
  if (input.transactionHashBeforePolicy !== input.transactionHashAtExecution) {
    block("TRANSACTION_IMMUTABILITY", "Transaction changed after policy review.");
  }

  if (reasons.some((reason) => reason.severity === "BLOCK")) {
    return {
      outcome: "BLOCKED",
      riskScore: 100,
      reasons,
      policyVersion: "circuitbreaker-v1"
    };
  }

  if (input.amountUsdcAtomic > AUTO_LIMIT) {
    escalate("AUTO_SPEND_LIMIT", "Amount exceeds the 0.01 USDC autonomous limit.");
  }
  if (input.action === "YIELD") {
    escalate("SENSITIVE_ACTION", "Opening a yield position requires hardware approval.");
  }
  if (reasons.some((reason) => reason.severity === "ESCALATE")) {
    return {
      outcome: "LEDGER_REQUIRED",
      riskScore: Math.min(90, 45 + reasons.length * 10),
      reasons,
      policyVersion: "circuitbreaker-v1"
    };
  }

  return {
    outcome: "AUTO_APPROVED",
    riskScore: 10,
    reasons: [
      {
        rule: "POLICY_PASS",
        severity: "INFO",
        message: "Flow is inside every autonomous execution boundary."
      }
    ],
    policyVersion: "circuitbreaker-v1"
  };
};
