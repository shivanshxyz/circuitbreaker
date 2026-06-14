import { describe, expect, it } from "vitest";

import type { MissionRecord } from "@/lib/mission/store";
import { createMissionToken, readMissionToken } from "@/lib/mission/token";

const mission = {
  view: {
    id: "mission-1",
    approval: { flowHash: `0x${"11".repeat(32)}` }
  },
  policyInput: {
    amountUsdcAtomic: 10_000n
  },
  transaction: {
    to: "0x1111111111111111111111111111111111111111",
    data: "0x",
    value: 0n
  },
  approvals: []
} as unknown as MissionRecord;

describe("mission tokens", () => {
  it("round-trips mission records with bigint fields", () => {
    const token = createMissionToken(mission, "test-secret");
    const decoded = readMissionToken(token, "test-secret");

    expect(decoded.view.id).toBe("mission-1");
    expect(decoded.policyInput.amountUsdcAtomic).toBe(10_000n);
  });

  it("rejects modified tokens", () => {
    const token = createMissionToken(mission, "test-secret");
    const modified = `${token.slice(0, -1)}x`;

    expect(() => readMissionToken(modified, "test-secret")).toThrow(
      "Mission token verification failed."
    );
  });
});
