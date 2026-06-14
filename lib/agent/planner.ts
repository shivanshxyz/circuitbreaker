import { parseUnits } from "viem";
import { z } from "zod";

import type { CompileMissionInput } from "@/lib/mission/types";
import type { ServerEnv } from "@/lib/env";

const amountPattern = /\b(\d+(?:\.\d{1,6})?)\s*usdc\b/i;

export const agentPlanSchema = z.object({
  action: z.literal("SWAP"),
  inputToken: z.literal("USDC"),
  outputToken: z.literal("WETH"),
  amountUsdc: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/),
  maxSlippageBps: z.literal(100),
  rationale: z.string().min(12).max(240),
  planner: z.enum(["OPENAI_STRUCTURED", "DETERMINISTIC_FALLBACK"])
});

export type AgentPlan = z.infer<typeof agentPlanSchema>;

const validatePlan = (
  plan: Omit<AgentPlan, "planner">,
  budgetUsdc: string,
  planner: AgentPlan["planner"]
) => {
  if (parseUnits(plan.amountUsdc, 6) > parseUnits(budgetUsdc, 6)) {
    throw new Error(
      `The agent selected ${plan.amountUsdc} USDC, above the ${budgetUsdc} USDC budget.`
    );
  }
  return agentPlanSchema.parse({ ...plan, planner });
};

const deterministicPlan = ({
  objective,
  amountUsdc
}: CompileMissionInput): AgentPlan => {
  const normalized = objective.toLowerCase();
  if (!normalized.includes("swap")) {
    throw new Error("The agent currently supports only swap objectives.");
  }
  if (!normalized.includes("usdc") || !normalized.includes("weth")) {
    throw new Error("The objective must specify a USDC to WETH swap.");
  }

  const mentionedAmount = objective.match(amountPattern)?.[1] ?? amountUsdc;
  if (parseUnits(mentionedAmount, 6) > parseUnits(amountUsdc, 6)) {
    throw new Error(
      `The objective requests ${mentionedAmount} USDC, above the ${amountUsdc} USDC budget.`
    );
  }

  return validatePlan({
    action: "SWAP",
    inputToken: "USDC",
    outputToken: "WETH",
    amountUsdc: mentionedAmount,
    maxSlippageBps: 100,
    rationale:
      "Use the supported USDC to WETH Composer template and defer execution authority to deterministic policy."
  }, amountUsdc, "DETERMINISTIC_FALLBACK");
};

type ResponsesPayload = {
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
};

const modelPlan = async (
  input: CompileMissionInput,
  env: Pick<ServerEnv, "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL">
) => {
  if (!env.LLM_API_KEY) return null;

  const response = await fetch(`${env.LLM_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.LLM_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      input: [
        {
          role: "system",
          content:
            "You are a bounded DeFi intent planner. You may only plan a USDC to WETH swap on Base. Never produce addresses, calldata, policy decisions, or execution instructions. Select an amount no greater than the supplied budget."
        },
        {
          role: "user",
          content: `Objective: ${input.objective}\nMaximum budget: ${input.amountUsdc} USDC`
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "circuitbreaker_agent_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: { type: "string", enum: ["SWAP"] },
              inputToken: { type: "string", enum: ["USDC"] },
              outputToken: { type: "string", enum: ["WETH"] },
              amountUsdc: {
                type: "string",
                pattern: "^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,6})?$"
              },
              maxSlippageBps: { type: "integer", enum: [100] },
              rationale: { type: "string", minLength: 12, maxLength: 240 }
            },
            required: [
              "action",
              "inputToken",
              "outputToken",
              "amountUsdc",
              "maxSlippageBps",
              "rationale"
            ]
          }
        }
      }
    }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) {
    throw new Error(`Intent model returned ${response.status}.`);
  }

  const payload = (await response.json()) as ResponsesPayload;
  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new Error("Intent model returned no structured plan.");

  const parsed = agentPlanSchema
    .omit({ planner: true })
    .parse(JSON.parse(text));
  return validatePlan(parsed, input.amountUsdc, "OPENAI_STRUCTURED");
};

export const planMissionIntent = async (
  input: CompileMissionInput,
  env?: Pick<ServerEnv, "LLM_API_KEY" | "LLM_BASE_URL" | "LLM_MODEL">
): Promise<AgentPlan> => {
  if (env?.LLM_API_KEY) {
    try {
      const plan = await modelPlan(input, env);
      if (plan) return plan;
    } catch {
      // Model availability must not make the guarded execution path unavailable.
    }
  }
  return deterministicPlan(input);
};
