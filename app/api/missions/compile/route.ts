import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { compileMission } from "@/lib/mission/compile";
import { saveMission } from "@/lib/mission/store";
import { compileMissionSchema } from "@/lib/mission/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = compileMissionSchema.parse(await request.json());
    const mission = saveMission(await compileMission(input));
    return NextResponse.json({ mission: mission.view });
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
