import type { Address, Hex } from "viem";

import type { MissionView } from "@/lib/mission/types";
import type { PolicyInput } from "@/lib/policy/types";

const globalMissionStore = globalThis as typeof globalThis & {
  circuitBreakerMissions?: Map<string, MissionRecord>;
};

const missions =
  globalMissionStore.circuitBreakerMissions ?? new Map<string, MissionRecord>();

globalMissionStore.circuitBreakerMissions = missions;

export type StoredTransaction = {
  to: Address;
  data: Hex;
  value: bigint;
  gasLimit?: bigint;
};

export type MissionRecord = {
  view: MissionView;
  policyInput: PolicyInput;
  transaction: StoredTransaction;
  approvals: readonly StoredTransaction[];
  ledgerSignature?: Hex;
};

export const saveMission = (mission: MissionRecord) => {
  missions.set(mission.view.id, mission);
  return mission;
};

export const getMission = (id: string) => missions.get(id) ?? null;

export const updateMission = (
  id: string,
  update: (mission: MissionRecord) => MissionRecord
) => {
  const mission = getMission(id);
  if (!mission) return null;
  const updated = update(mission);
  missions.set(id, updated);
  return updated;
};
