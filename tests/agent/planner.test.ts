import { afterEach, describe, expect, it, vi } from "vitest";

import { planMissionIntent } from "@/lib/agent/planner";

describe("planMissionIntent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts a bounded USDC to WETH intent", async () => {
    const plan = await planMissionIntent({
      objective: "Swap 0.08 USDC to WETH after hardware approval",
      amountUsdc: "0.08"
    });

    expect(plan.amountUsdc).toBe("0.08");
    expect(plan.action).toBe("SWAP");
  });

  it("rejects objectives above the user budget", async () => {
    await expect(
      planMissionIntent({
        objective: "Swap 1 USDC to WETH",
        amountUsdc: "0.08"
      })
    ).rejects.toThrow("above the 0.08 USDC budget");
  });

  it("rejects unsupported arbitrary objectives", async () => {
    await expect(
      planMissionIntent({
        objective: "Send 0.02 USDC to an arbitrary address",
        amountUsdc: "0.02"
      })
    ).rejects.toThrow("only swap objectives");
  });

  it("accepts only schema-valid structured model output inside the budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    action: "SWAP",
                    inputToken: "USDC",
                    outputToken: "WETH",
                    amountUsdc: "0.07",
                    maxSlippageBps: 100,
                    rationale:
                      "Use the bounded Composer swap while preserving the remaining budget."
                  })
                }
              ]
            }
          ]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planMissionIntent(
      {
        objective: "Swap up to 0.08 USDC to WETH",
        amountUsdc: "0.08"
      },
      {
        LLM_API_KEY: "test-key",
        LLM_BASE_URL: "https://api.openai.com/v1",
        LLM_MODEL: "gpt-5.4-mini"
      }
    );

    expect(plan.planner).toBe("OPENAI_STRUCTURED");
    expect(plan.amountUsdc).toBe("0.07");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("falls back deterministically when the model is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const plan = await planMissionIntent(
      {
        objective: "Swap 0.02 USDC to WETH",
        amountUsdc: "0.02"
      },
      {
        LLM_API_KEY: "test-key",
        LLM_BASE_URL: "https://api.openai.com/v1",
        LLM_MODEL: "gpt-5.4-mini"
      }
    );

    expect(plan.planner).toBe("DETERMINISTIC_FALLBACK");
  });
});
