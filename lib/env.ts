import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address");
const optionalAddressSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  addressSchema.optional()
);
const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional()
);

const serverSchema = z.object({
  LIFI_API_KEY: z.string().min(1).optional(),
  LIFI_COMPOSER_BASE_URL: z
    .string()
    .url()
    .default("https://ethglobal-composer.li.quest"),
  COMPOSER_SIGNER_ADDRESS: addressSchema.optional(),
  DYNAMIC_AUTH_TOKEN: z.string().min(1).optional(),
  DYNAMIC_ENVIRONMENT_ID: z.string().min(1).optional(),
  DYNAMIC_WALLET_PASSWORD: z.string().min(1).optional(),
  DYNAMIC_WALLET_METADATA_JSON: optionalSecretSchema,
  DYNAMIC_WALLET_METADATA_PATH: z
    .string()
    .default(".circuitbreaker-wallet/wallet-metadata.json"),
  MISSION_SIGNING_SECRET: optionalSecretSchema,
  LEDGER_APPROVER_ADDRESS: optionalAddressSchema,
  LLM_API_KEY: optionalSecretSchema,
  LLM_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  LLM_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  BASE_RPC_URL: z.string().url().default("https://mainnet.base.org")
});

export type ServerEnv = z.infer<typeof serverSchema>;

export const readServerEnv = (): ServerEnv => serverSchema.parse(process.env);

export function requireEnv<K extends keyof ServerEnv>(
  env: ServerEnv,
  keys: readonly K[]
): asserts env is ServerEnv & Required<Pick<ServerEnv, K>> {
  const missing = keys.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env.local and fill in the values."
    );
  }
}
