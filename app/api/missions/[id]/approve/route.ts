import { NextResponse } from "next/server";
import {
  isAddress,
  isHex,
  recoverTypedDataAddress,
  type Address,
  type Hex
} from "viem";

import {
  buildMissionApprovalTypedData,
  SIMULATOR_APPROVER
} from "@/lib/mission/approval";
import { getMission, saveMission } from "@/lib/mission/store";
import { createMissionToken, readMissionToken } from "@/lib/mission/token";
import { readServerEnv, requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json()) as {
    signature?: string;
    approver?: string;
    missionToken?: string;
  };
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
  if (mission.view.decision.outcome !== "LEDGER_REQUIRED") {
    return NextResponse.json(
      { error: "This mission does not require Ledger approval." },
      { status: 409 }
    );
  }
  if (
    mission.view.state === "LEDGER_APPROVED" ||
    mission.view.state === "EXECUTED" ||
    mission.ledgerSignature
  ) {
    return NextResponse.json(
      { error: "This one-time Ledger authorization has already been used." },
      { status: 409 }
    );
  }
  if (Math.floor(Date.now() / 1000) >= mission.view.approval.expiresAtUnix) {
    return NextResponse.json({ error: "Mission has expired." }, { status: 409 });
  }

  if (!body.signature || !isHex(body.signature) || !body.approver || !isAddress(body.approver)) {
    return NextResponse.json(
      { error: "A valid approver and signature are required." },
      { status: 400 }
    );
  }

  const recovered = await recoverTypedDataAddress({
    ...buildMissionApprovalTypedData(mission),
    signature: body.signature as Hex
  });
  const expectedApprover =
    (env.LEDGER_APPROVER_ADDRESS as Address | undefined) ?? SIMULATOR_APPROVER;

  if (
    recovered.toLowerCase() !== body.approver.toLowerCase() ||
    recovered.toLowerCase() !== expectedApprover.toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Signature does not match the configured Ledger approver." },
      { status: 403 }
    );
  }

  const updated = saveMission({
    ...mission,
    ledgerSignature: body.signature as Hex,
    view: {
      ...mission.view,
      state: "LEDGER_APPROVED",
      approval: {
        ...mission.view.approval,
        approvedBy: recovered
      }
    }
  });

  requireEnv(env, ["MISSION_SIGNING_SECRET"]);
  return NextResponse.json({
    mission: updated.view,
    missionToken: createMissionToken(updated, env.MISSION_SIGNING_SECRET)
  });
}
