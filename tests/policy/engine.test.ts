import { describe, expect, it } from "vitest";

import {
  ABSOLUTE_LIMIT,
  AUTO_LIMIT,
  evaluatePolicy
} from "@/lib/policy/engine";
import type { PolicyInput } from "@/lib/policy/types";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const HASH = `0x${"ab".repeat(32)}` as const;

const validInput = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({
  chainId: 8453,
  action: "SWAP",
  amountUsdcAtomic: 10_000n,
  maxSlippageBps: 100,
  simulatedPriceImpactBps: 20,
  simulationSucceeded: true,
  signer: ADDRESS_A,
  expectedSigner: ADDRESS_A,
  target: ADDRESS_B,
  allowedTargets: [ADDRESS_B],
  tokens: [TOKEN],
  allowedTokens: [TOKEN],
  approvals: [],
  hasExpectedMinimumOutput: true,
  compiledAtUnix: 100,
  expiresAtUnix: 200,
  nowUnix: 150,
  transactionHashBeforePolicy: HASH,
  transactionHashAtExecution: HASH,
  ...overrides
});

describe("evaluatePolicy", () => {
  it("auto-approves a low-risk swap", () => {
    expect(evaluatePolicy(validInput()).outcome).toBe("AUTO_APPROVED");
  });

  it("requires Ledger above the autonomous limit", () => {
    expect(
      evaluatePolicy(validInput({ amountUsdcAtomic: AUTO_LIMIT + 1n })).outcome
    ).toBe("LEDGER_REQUIRED");
  });

  it("requires Ledger for yield", () => {
    expect(evaluatePolicy(validInput({ action: "YIELD" })).outcome).toBe(
      "LEDGER_REQUIRED"
    );
  });

  it("blocks above the absolute limit", () => {
    expect(
      evaluatePolicy(validInput({ amountUsdcAtomic: ABSOLUTE_LIMIT + 1n })).outcome
    ).toBe("BLOCKED");
  });

  it.each([
    ["unsupported chain", { chainId: 1 }],
    ["high slippage", { maxSlippageBps: 101 }],
    ["failed simulation", { simulationSucceeded: false }],
    ["wrong signer", { signer: ADDRESS_B }],
    ["unknown target", { target: ADDRESS_A }],
    ["missing minimum", { hasExpectedMinimumOutput: false }],
    ["expired flow", { nowUnix: 200 }],
    [
      "transaction mutation",
      { transactionHashAtExecution: `0x${"cd".repeat(32)}` }
    ]
  ])("blocks %s", (_name, overrides) => {
    expect(evaluatePolicy(validInput(overrides as Partial<PolicyInput>)).outcome).toBe(
      "BLOCKED"
    );
  });

  it("blocks an unlimited approval", () => {
    expect(
      evaluatePolicy(
        validInput({
          approvals: [
            {
              token: TOKEN,
              spender: ADDRESS_B,
              amount: 2n ** 256n - 1n,
              isUnlimited: true
            }
          ]
        })
      ).outcome
    ).toBe("BLOCKED");
  });

  it("auto-approves an exact bounded approval inside the spend limit", () => {
    expect(
      evaluatePolicy(
        validInput({
          approvals: [
            {
              token: TOKEN,
              spender: ADDRESS_B,
              amount: 10_000n,
              isUnlimited: false
            }
          ]
        })
      ).outcome
    ).toBe("AUTO_APPROVED");
  });
});
