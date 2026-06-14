"use client";

import type { EIP6963ProviderDetail } from "@ledgerhq/ledger-wallet-provider";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent
} from "react";
import { privateKeyToAccount } from "viem/accounts";

import { buildFlowApprovalTypedData } from "@/lib/ledger/typed-data";
import type { MissionView } from "@/lib/mission/types";
import type { PolicyDecision } from "@/lib/policy/types";

const presets = [
  {
    label: "Autonomous",
    amount: "0.01",
    objective: "Swap 0.01 USDC to WETH with strict execution controls"
  },
  {
    label: "Ledger gate",
    amount: "5",
    objective: "Swap 5 USDC to WETH only after hardware approval"
  },
  {
    label: "Hard block",
    amount: "11",
    objective: "Swap 11 USDC to WETH even if it exceeds treasury policy"
  }
] as const;

const simulatorAccount = privateKeyToAccount(`0x${"42".repeat(32)}`);
type ChallengeScenario =
  | "CALLDATA_MUTATION"
  | "EXPIRED_FLOW"
  | "WRONG_SIGNER"
  | "UNLIMITED_APPROVAL";

export function MissionControl() {
  const [objective, setObjective] = useState<string>(presets[0].objective);
  const [amountUsdc, setAmountUsdc] = useState<string>(presets[0].amount);
  const [mission, setMission] = useState<MissionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isChallenging, setIsChallenging] = useState(false);
  const [challengeResult, setChallengeResult] = useState<{
    scenario: ChallengeScenario;
    decision: PolicyDecision;
  } | null>(null);
  const [ledgerProvider, setLedgerProvider] =
    useState<EIP6963ProviderDetail | null>(null);
  const [ledgerAccount, setLedgerAccount] = useState<string | null>(null);
  const hasLedgerApiKey = Boolean(process.env.NEXT_PUBLIC_LEDGER_API_KEY);
  const isDemoReadOnly =
    process.env.NEXT_PUBLIC_DEMO_READ_ONLY === "true";

  const onLedgerAnnounce = useCallback((event: Event) => {
    const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
    if (detail.info.name.toLowerCase().includes("ledger")) {
      setLedgerProvider(detail);
    }
  }, []);

  useEffect(() => {
    if (!hasLedgerApiKey) return;

    let cleanup: (() => void) | undefined;
    const initialize = async () => {
      await import("@ledgerhq/ledger-wallet-provider/styles.css");
      const { initializeLedgerProvider } = await import(
        "@ledgerhq/ledger-wallet-provider"
      );

      window.addEventListener("eip6963:announceProvider", onLedgerAnnounce);
      cleanup = initializeLedgerProvider({
        apiKey: process.env.NEXT_PUBLIC_LEDGER_API_KEY,
        dAppIdentifier:
          process.env.NEXT_PUBLIC_LEDGER_DAPP_IDENTIFIER ?? "circuitbreaker",
        environment:
          process.env.NEXT_PUBLIC_LEDGER_ENVIRONMENT === "production"
            ? "production"
            : "staging",
        hideButton: true,
        loggerLevel: "warn"
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    };

    initialize().catch((cause: unknown) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Ledger provider initialization failed."
      );
    });

    return () => {
      cleanup?.();
      window.removeEventListener("eip6963:announceProvider", onLedgerAnnounce);
    };
  }, [hasLedgerApiKey, onLedgerAnnounce]);

  const compile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMission(null);
    setChallengeResult(null);
    setIsCompiling(true);

    try {
      const response = await fetch("/api/missions/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ objective, amountUsdc })
      });
      const payload = (await response.json()) as {
        mission?: MissionView;
        error?: string;
      };
      if (!response.ok || !payload.mission) {
        throw new Error(payload.error ?? "Mission compilation failed.");
      }
      setMission(payload.mission);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Mission compilation failed."
      );
    } finally {
      setIsCompiling(false);
    }
  };

  const connectLedger = async () => {
    setError(null);
    if (!hasLedgerApiKey) {
      setLedgerAccount(simulatorAccount.address);
      return;
    }
    if (!ledgerProvider) {
      setError("Ledger provider is still initializing.");
      return;
    }

    try {
      const accounts = (await ledgerProvider.provider.request({
        method: "eth_requestAccounts",
        params: []
      })) as string[];
      if (!accounts[0]) throw new Error("Ledger returned no account.");
      setLedgerAccount(accounts[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ledger connection failed.");
    }
  };

  const approve = async () => {
    if (!mission || !ledgerAccount) return;
    setError(null);
    setIsApproving(true);

    try {
      const typedData = buildFlowApprovalTypedData({
        intent: `Swap ${mission.amountUsdc} USDC for WETH`,
        minimumReceived: `${mission.simulation.minimumOutputWeth} WETH`,
        network: "Base mainnet",
        flowHash: mission.approval.flowHash,
        agentWallet: mission.agentWallet,
        transactionTo: mission.simulation.transactionTarget,
        transactionValue: 0n,
        calldataHash: mission.approval.calldataHash,
        riskDigest: mission.approval.riskDigest,
        expiresAt: BigInt(mission.approval.expiresAtUnix),
        nonce: mission.approval.nonce
      });
      const signature = hasLedgerApiKey
        ? ((await ledgerProvider?.provider.request({
            method: "eth_signTypedData_v4",
            params: [
              ledgerAccount,
              JSON.stringify(typedData, (_key, value) =>
                typeof value === "bigint" ? value.toString() : value
              )
            ]
          })) as `0x${string}`)
        : await simulatorAccount.signTypedData(typedData);

      if (!signature) throw new Error("Ledger returned no signature.");
      const response = await fetch(`/api/missions/${mission.id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signature,
          approver: ledgerAccount
        })
      });
      const payload = (await response.json()) as {
        mission?: MissionView;
        error?: string;
      };
      if (!response.ok || !payload.mission) {
        throw new Error(payload.error ?? "Ledger approval failed.");
      }
      setMission(payload.mission);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Ledger approval failed.";
      setError(
        message.includes("Address mismatch") ||
          message.includes("IncorrectSeedError")
          ? "The selected Ledger Sync account is not derived from the connected device. Select an Ethereum account created by this Ledger device, then reconnect."
          : message
      );
    } finally {
      setIsApproving(false);
    }
  };

  const execute = async () => {
    if (!mission) return;
    setError(null);
    setIsExecuting(true);

    try {
      const response = await fetch(`/api/missions/${mission.id}/execute`, {
        method: "POST"
      });
      const payload = (await response.json()) as {
        mission?: MissionView;
        error?: string;
      };
      if (!response.ok || !payload.mission) {
        throw new Error(payload.error ?? "Dynamic execution failed.");
      }
      setMission(payload.mission);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dynamic execution failed.");
    } finally {
      setIsExecuting(false);
    }
  };

  const runChallenge = async (scenario: ChallengeScenario) => {
    if (!mission) return;
    setError(null);
    setIsChallenging(true);

    try {
      const response = await fetch(`/api/missions/${mission.id}/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario })
      });
      const payload = (await response.json()) as {
        scenario?: ChallengeScenario;
        decision?: PolicyDecision;
        error?: string;
      };
      if (!response.ok || !payload.scenario || !payload.decision) {
        throw new Error(payload.error ?? "Challenge simulation failed.");
      }
      setChallengeResult({
        scenario: payload.scenario,
        decision: payload.decision
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Challenge simulation failed."
      );
    } finally {
      setIsChallenging(false);
    }
  };

  return (
    <section className="mission-panel" aria-labelledby="control-title">
      <div className="mission-intro">
        <div>
          <h2 id="control-title">Live Policy Simulation</h2>
        </div>
      </div>

      <div className="mission-workspace">
        <form className="mission-form" onSubmit={compile}>
          <fieldset className="preset-group">
            <legend>Risk scenario</legend>
            {presets.map((preset) => (
              <button
                className={
                  amountUsdc === preset.amount
                    ? "preset-button preset-button-active"
                    : "preset-button"
                }
                key={preset.label}
                onClick={() => {
                  setAmountUsdc(preset.amount);
                  setObjective(preset.objective);
                }}
                type="button"
              >
                <span>{preset.label}</span>
                <strong>{preset.amount} USDC</strong>
              </button>
            ))}
          </fieldset>

          <label className="field">
            <span>Agent objective</span>
            <textarea
              maxLength={240}
              onChange={(event) => setObjective(event.target.value)}
              rows={4}
              value={objective}
            />
          </label>

          <label className="field">
            <span>Maximum input (USDC)</span>
            <input
              inputMode="decimal"
              onChange={(event) => setAmountUsdc(event.target.value)}
              value={amountUsdc}
            />
          </label>

          <button
            aria-busy={isCompiling}
            className="button button-primary compile-button"
            disabled={isCompiling}
            type="submit"
          >
            {isCompiling ? "Compiling and simulating…" : "Compile mission"}
          </button>

          {error ? (
            <div className="error-state" role="alert">
              <strong>Mission rejected</strong>
              <p>{error}</p>
            </div>
          ) : null}
        </form>

        <div className="mission-result" aria-live="polite">
          {!mission ? (
            <div className="empty-result">
              <span>Awaiting mission</span>
              <p>
                No transaction is signed or broadcast during this simulation.
              </p>
            </div>
          ) : (
            <>
              <div className="result-heading">
                <div>
                  <span>Policy outcome</span>
                  <strong>{mission.decision.outcome.replace("_", " ")}</strong>
                </div>
                <span
                  className={`risk-badge risk-${mission.decision.outcome.toLowerCase()}`}
                >
                  Risk {mission.decision.riskScore}
                </span>
              </div>

              <div className="agent-decision">
                <div>
                  <span>Bounded intent agent</span>
                  <strong>
                    {mission.agentPlan.action} {mission.agentPlan.amountUsdc}{" "}
                    {mission.agentPlan.inputToken} →{" "}
                    {mission.agentPlan.outputToken}
                  </strong>
                </div>
                <span
                  className={`planner-badge planner-${mission.agentPlan.planner.toLowerCase()}`}
                >
                  {mission.agentPlan.planner === "OPENAI_STRUCTURED"
                    ? "Strict model output"
                    : "Deterministic fallback"}
                </span>
                <p>{mission.agentPlan.rationale}</p>
              </div>

              <ol className="plan-list">
                {mission.plan.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>

              <dl className="mission-facts">
                <div>
                  <dt>Expected WETH</dt>
                  <dd>{mission.simulation.outputWeth}</dd>
                </div>
                <div>
                  <dt>Minimum WETH</dt>
                  <dd>{mission.simulation.minimumOutputWeth}</dd>
                </div>
                <div>
                  <dt>Approval</dt>
                  <dd>{mission.simulation.approvalMode}</dd>
                </div>
                <div>
                  <dt>Price impact</dt>
                  <dd>
                    {mission.simulation.priceImpactBps === null
                      ? "Unavailable"
                      : `${mission.simulation.priceImpactBps} bps`}
                  </dd>
                </div>
              </dl>

              <div className="reason-list">
                {mission.decision.reasons.map((reason) => (
                  <div key={reason.rule}>
                    <span>{reason.severity}</span>
                    <p>{reason.message}</p>
                  </div>
                ))}
              </div>

              <div className="flow-hash">
                <span>Mission-bound flow hash</span>
                <code>{mission.approval.flowHash}</code>
              </div>

              <dl className="approval-manifest">
                <div>
                  <dt>Ledger intent</dt>
                  <dd>{`Swap ${mission.amountUsdc} USDC for WETH`}</dd>
                </div>
                <div>
                  <dt>Minimum received</dt>
                  <dd>{mission.simulation.minimumOutputWeth} WETH</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>Base mainnet (8453)</dd>
                </div>
                <div>
                  <dt>Agent wallet</dt>
                  <dd>
                    <code>{mission.agentWallet}</code>
                  </dd>
                </div>
                <div>
                  <dt>Composer target</dt>
                  <dd>
                    <code>{mission.simulation.transactionTarget}</code>
                  </dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>
                    {new Date(
                      mission.approval.expiresAtUnix * 1000
                    ).toLocaleString()}
                  </dd>
                </div>
              </dl>

              {ledgerAccount ? (
                <div className="flow-hash">
                  <span>Ledger approval account</span>
                  <code>{ledgerAccount}</code>
                </div>
              ) : null}

              {mission.state === "LEDGER_APPROVED" &&
              mission.approval.approvedBy ? (
                <div className="authorization-certificate">
                  <div className="certificate-heading">
                    <span>Hardware authorization certificate</span>
                    <strong>Verified</strong>
                  </div>
                  <p>
                    This Ledger account authorized only this compiled Flow.
                    Any change to the target, calldata, policy, nonce, or expiry
                    invalidates the signature.
                  </p>
                  <dl>
                    <div>
                      <dt>Authorized signer</dt>
                      <dd><code>{mission.approval.approvedBy}</code></dd>
                    </div>
                    <div>
                      <dt>Execution scope</dt>
                      <dd>{`Swap ${mission.amountUsdc} USDC for WETH`}</dd>
                    </div>
                    <div>
                      <dt>Immutable flow</dt>
                      <dd><code>{mission.approval.flowHash}</code></dd>
                    </div>
                    <div>
                      <dt>Valid until</dt>
                      <dd>
                        {new Date(
                          mission.approval.expiresAtUnix * 1000
                        ).toLocaleTimeString()}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}

              {mission.execution ? (
                <div className="execution-proof">
                  <strong>Executed by Dynamic</strong>
                  {mission.execution.transactionHashes.map((hash) => (
                    <a
                      href={`https://basescan.org/tx/${hash}`}
                      key={hash}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {hash}
                    </a>
                  ))}
                </div>
              ) : null}

              <div className="challenge-lab">
                <div className="section-heading">
                  <span>Adversarial proof lab</span>
                  <strong>Read-only</strong>
                </div>
                <p>
                  Re-run the policy against common post-review attacks without
                  changing the stored mission or moving funds.
                </p>
                <div className="challenge-actions">
                  <button
                    disabled={isChallenging}
                    onClick={() => runChallenge("CALLDATA_MUTATION")}
                    type="button"
                  >
                    Mutate calldata
                  </button>
                  <button
                    disabled={isChallenging}
                    onClick={() => runChallenge("EXPIRED_FLOW")}
                    type="button"
                  >
                    Expire flow
                  </button>
                  <button
                    disabled={isChallenging}
                    onClick={() => runChallenge("WRONG_SIGNER")}
                    type="button"
                  >
                    Swap signer
                  </button>
                  <button
                    disabled={isChallenging}
                    onClick={() => runChallenge("UNLIMITED_APPROVAL")}
                    type="button"
                  >
                    Unlimited approval
                  </button>
                </div>
                {challengeResult ? (
                  <div className="challenge-result">
                    <strong>
                      {challengeResult.scenario.replaceAll("_", " ")}:{" "}
                      {challengeResult.decision.outcome}
                    </strong>
                    <p>{challengeResult.decision.reasons[0]?.message}</p>
                  </div>
                ) : null}
              </div>

              {mission.decision.outcome !== "BLOCKED" &&
              mission.state !== "EXECUTED" ? (
                <div className="mission-actions">
                  {mission.decision.outcome === "LEDGER_REQUIRED" ? (
                    ledgerAccount ? (
                      <button
                        className="button button-secondary"
                        disabled={
                          isApproving || mission.state === "LEDGER_APPROVED"
                        }
                        onClick={approve}
                        type="button"
                      >
                        {mission.state === "LEDGER_APPROVED"
                          ? "Ledger approval verified"
                          : isApproving
                            ? "Confirm on Ledger…"
                            : hasLedgerApiKey
                              ? "Approve exact flow on Ledger"
                              : "Approve with Ledger simulator"}
                      </button>
                    ) : (
                      <button
                        className="button button-secondary"
                        disabled={hasLedgerApiKey && !ledgerProvider}
                        onClick={connectLedger}
                        type="button"
                      >
                        {hasLedgerApiKey && !ledgerProvider
                          ? "Initializing Ledger…"
                          : hasLedgerApiKey
                            ? "Connect physical Ledger"
                            : "Connect Ledger simulator"}
                      </button>
                    )
                  ) : null}
                  <button
                    className="button button-primary"
                    disabled={
                      isDemoReadOnly ||
                      isExecuting ||
                      (mission.decision.outcome === "LEDGER_REQUIRED" &&
                        mission.state !== "LEDGER_APPROVED")
                    }
                    onClick={execute}
                    type="button"
                  >
                    {isDemoReadOnly
                      ? "Execution disabled for recording"
                      : isExecuting
                      ? "Dynamic is executing…"
                      : "Execute on Base mainnet"}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
