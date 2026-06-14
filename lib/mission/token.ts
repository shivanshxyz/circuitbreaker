import { createHmac, timingSafeEqual } from "node:crypto";

import type { MissionRecord } from "@/lib/mission/store";

const encode = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

const serializeMission = (mission: MissionRecord) =>
  JSON.stringify(mission, (_key, value) =>
    typeof value === "bigint" ? { __circuitBreakerBigInt: value.toString() } : value
  );

const deserializeMission = (payload: string) =>
  JSON.parse(payload, (_key, value) => {
    if (
      value &&
      typeof value === "object" &&
      "__circuitBreakerBigInt" in value
    ) {
      return BigInt(value.__circuitBreakerBigInt);
    }
    return value;
  }) as MissionRecord;

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest();

export const createMissionToken = (mission: MissionRecord, secret: string) => {
  const payload = encode(serializeMission(mission));
  return `${payload}.${encode(sign(payload, secret))}`;
};

export const readMissionToken = (token: string, secret: string) => {
  const [payload, encodedSignature] = token.split(".");
  if (!payload || !encodedSignature) {
    throw new Error("Invalid mission token.");
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = sign(payload, secret);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new Error("Mission token verification failed.");
  }

  return deserializeMission(Buffer.from(payload, "base64url").toString("utf8"));
};
