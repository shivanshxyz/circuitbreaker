import { NextResponse } from "next/server";
import { maxUint256 } from "viem";
import { z } from "zod";

import { getMission } from "@/lib/mission/store";
import { evaluatePolicy } from "@/lib/policy/engine";

const challengeSchema = z.object({
  scenario: z.enum([
    "CALLDATA_MUTATION",
    "EXPIRED_FLOW",
    "WRONG_SIGNER",
    "UNLIMITED_APPROVAL"
  ])
});

const MUTATED_HASH = `0x${"ff".repeat(32)}` as const;
const WRONG_SIGNER = "0x0000000000000000000000000000000000000001";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mission = getMission(id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  }

  const { scenario } = challengeSchema.parse(await request.json());
  const input = { ...mission.policyInput };

  if (scenario === "CALLDATA_MUTATION") {
    input.transactionHashAtExecution = MUTATED_HASH;
  }
  if (scenario === "EXPIRED_FLOW") {
    input.nowUnix = input.expiresAtUnix;
  }
  if (scenario === "WRONG_SIGNER") {
    input.signer = WRONG_SIGNER;
  }
  if (scenario === "UNLIMITED_APPROVAL") {
    input.approvals = [
      {
        token: input.allowedTokens[0],
        spender: input.allowedTargets[0],
        amount: maxUint256,
        isUnlimited: true
      }
    ];
  }

  return NextResponse.json({
    scenario,
    decision: evaluatePolicy(input)
  });
}
