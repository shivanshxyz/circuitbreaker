import { z } from "zod";

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/) as z.ZodType<`0x${string}`>;

export const hexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/) as z.ZodType<`0x${string}`>;

export const policyInputSchema = z.object({
  chainId: z.number().int().positive(),
  action: z.enum(["SWAP", "YIELD"]),
  amountUsdcAtomic: z.bigint().nonnegative(),
  maxSlippageBps: z.number().int().nonnegative(),
  simulatedPriceImpactBps: z.number().int().optional(),
  simulationSucceeded: z.boolean(),
  signer: addressSchema,
  expectedSigner: addressSchema,
  target: addressSchema,
  allowedTargets: z.array(addressSchema),
  tokens: z.array(addressSchema),
  allowedTokens: z.array(addressSchema),
  approvals: z.array(
    z.object({
      token: addressSchema,
      spender: addressSchema,
      amount: z.bigint().nonnegative(),
      isUnlimited: z.boolean()
    })
  ),
  hasExpectedMinimumOutput: z.boolean(),
  compiledAtUnix: z.number().int().nonnegative(),
  expiresAtUnix: z.number().int().nonnegative(),
  nowUnix: z.number().int().nonnegative(),
  transactionHashBeforePolicy: hexSchema,
  transactionHashAtExecution: hexSchema
});

export type PolicyInput = z.infer<typeof policyInputSchema>;

export type PolicyReason = {
  rule: string;
  severity: "INFO" | "ESCALATE" | "BLOCK";
  message: string;
};

export type PolicyDecision = {
  outcome: "AUTO_APPROVED" | "LEDGER_REQUIRED" | "BLOCKED";
  riskScore: number;
  reasons: PolicyReason[];
  policyVersion: "circuitbreaker-v1";
};
