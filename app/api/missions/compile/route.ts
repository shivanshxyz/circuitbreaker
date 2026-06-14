import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { compileMission } from "@/lib/mission/compile";
import { saveMission } from "@/lib/mission/store";
import { createMissionToken } from "@/lib/mission/token";
import { compileMissionSchema } from "@/lib/mission/types";
import { readServerEnv, requireEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = compileMissionSchema.parse(await request.json());
    const mission = saveMission(await compileMission(input));
    const env = readServerEnv();
    requireEnv(env, ["MISSION_SIGNING_SECRET"]);
    return NextResponse.json({
      mission: mission.view,
      missionToken: createMissionToken(mission, env.MISSION_SIGNING_SECRET)
    });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? error.issues[0]?.message ?? "Invalid mission."
        : error instanceof Error
          ? error.message
          : "Mission compilation failed.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
