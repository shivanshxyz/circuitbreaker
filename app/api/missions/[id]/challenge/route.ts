import { NextResponse } from "next/server";
import { maxUint256 } from "viem";
import { z } from "zod";

import { getMission } from "@/lib/mission/store";
import { readMissionToken } from "@/lib/mission/token";
import { evaluatePolicy } from "@/lib/policy/engine";
import { readServerEnv, requireEnv } from "@/lib/env";

const challengeSchema = z.object({
  missionToken: z.string().min(1).optional(),
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
  const body = challengeSchema.parse(await request.json());
  const env = readServerEnv();
  const mission = body.missionToken
    ? (() => {
        requireEnv(env, ["MISSION_SIGNING_SECRET"]);
        return readMissionToken(body.missionToken, env.MISSION_SIGNING_SECRET);
      })()
    : getMission(id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  }
  if (mission.view.id !== id) {
    return NextResponse.json({ error: "Mission token does not match." }, { status: 400 });
  }

  const { scenario } = body;
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
