"use client";

import type { EIP6963ProviderDetail } from "@ledgerhq/ledger-wallet-provider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { privateKeyToAccount } from "viem/accounts";

import { buildFlowApprovalTypedData } from "@/lib/ledger/typed-data";

type Status = "idle" | "initializing" | "ready" | "signing" | "success" | "error";

const simulatorAccount = privateKeyToAccount(
  `0x${"42".repeat(32)}`
);

const sampleApproval = {
  intent: "Swap 5 USDC for WETH",
  minimumReceived: "0.002 WETH",
  network: "Base mainnet",
  flowHash: `0x${"11".repeat(32)}`,
  agentWallet: "0x284A5f5034fA9D6604b25C3E9C3C967E383bca1f",
  transactionTo: "0xa0ca0957fa87d3ed7243d8dfd442979fa5a0dd7a",
  transactionValue: 0n,
  calldataHash: `0x${"22".repeat(32)}`,
  riskDigest: `0x${"33".repeat(32)}`,
  expiresAt: 1_800_000_000n,
  nonce: `0x${"44".repeat(32)}`
} as const;

export function LedgerSpike() {
  const [providerDetail, setProviderDetail] =
    useState<EIP6963ProviderDetail | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [usingSimulator, setUsingSimulator] = useState(false);

  const isStub = !process.env.NEXT_PUBLIC_LEDGER_API_KEY;
  const typedData = useMemo(
    () => buildFlowApprovalTypedData(sampleApproval),
    []
  );

  const onAnnounce = useCallback((event: Event) => {
    const detail = (event as CustomEvent<EIP6963ProviderDetail>).detail;
    if (detail.info.name.toLowerCase().includes("ledger")) {
      setProviderDetail(detail);
      setStatus("ready");
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const initialize = async () => {
      await import("@ledgerhq/ledger-wallet-provider/styles.css");
      const { initializeLedgerProvider } = await import(
        "@ledgerhq/ledger-wallet-provider"
      );

      window.addEventListener("eip6963:announceProvider", onAnnounce);
      cleanup = initializeLedgerProvider({
        apiKey: process.env.NEXT_PUBLIC_LEDGER_API_KEY,
        dAppIdentifier:
          process.env.NEXT_PUBLIC_LEDGER_DAPP_IDENTIFIER ?? "circuitbreaker",
        environment:
          process.env.NEXT_PUBLIC_LEDGER_ENVIRONMENT === "production"
            ? "production"
            : "staging",
        hideButton: true,
        loggerLevel: "warn",
        devConfig: isStub
          ? {
              stub: {
                base: true,
                account: true,
                balance: true,
                device: true,
                web3Provider: true,
                dAppConfig: true
              }
            }
          : undefined
      });
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    };

    initialize().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Ledger initialization failed.");
      setStatus("error");
    });

    const fallbackTimer = window.setTimeout(() => {
      if (isStub) {
        setError(null);
        setUsingSimulator(true);
        setStatus("ready");
      }
    }, 1500);

    return () => {
      window.clearTimeout(fallbackTimer);
      cleanup?.();
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, [isStub, onAnnounce]);

  const connect = async () => {
    setError(null);
    if (usingSimulator) {
      setAccount(simulatorAccount.address);
      return;
    }
    if (!providerDetail) return;
    try {
      const accounts = (await providerDetail.provider.request({
        method: "eth_requestAccounts",
        params: []
      })) as string[];
      setAccount(accounts[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ledger connection failed.");
      setStatus("error");
    }
  };

  const sign = async () => {
    if (!account) return;
    setStatus("signing");
    setError(null);
    try {
      const result = usingSimulator
        ? await simulatorAccount.signTypedData(typedData)
        : ((await providerDetail?.provider.request({
            method: "eth_signTypedData_v4",
            params: [
              account,
              JSON.stringify(typedData, (_key, value) =>
                typeof value === "bigint" ? value.toString() : value
              )
            ]
          })) as string);
      setSignature(result);
      setStatus("success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ledger signature failed.");
      setStatus("error");
    }
  };

  return (
    <section className="ledger-panel" aria-labelledby="ledger-title">
      <div className="panel-copy">
        <p className="eyebrow">Hardware approval spike</p>
        <h2 id="ledger-title">Sign the exact flow, not a vague permission.</h2>
        <p>
          The approval binds the agent wallet, transaction target, calldata hash,
          policy digest, expiry, and one-time nonce.
        </p>
      </div>

      <div className="approval-console">
        <div className="console-row">
          <span>Provider</span>
          <strong>
            {usingSimulator
              ? "Local EIP-712 simulator"
              : isStub
                ? "Ledger SDK stub"
                : "Ledger hardware"}
          </strong>
        </div>
        <div className="console-row">
          <span>State</span>
          <strong>{status}</strong>
        </div>
        <div className="console-row">
          <span>Account</span>
          <code>{account ?? "Not connected"}</code>
        </div>
        <div className="console-row">
          <span>Flow hash</span>
          <code>{sampleApproval.flowHash}</code>
        </div>

        {error ? (
          <div className="error-state" role="alert">
            <strong>Ledger action failed</strong>
            <p>{error}</p>
          </div>
        ) : null}

        {signature ? (
          <div className="success-state">
            <strong>Approval signed</strong>
            <code>{signature}</code>
          </div>
        ) : null}

        <div className="actions">
          <button
            className="button button-secondary"
            disabled={(!providerDetail && !usingSimulator) || Boolean(account)}
            onClick={connect}
            type="button"
          >
            {account ? "Ledger connected" : "Connect Ledger"}
          </button>
          <button
            aria-busy={status === "signing"}
            className="button button-primary"
            disabled={!account || status === "signing"}
            onClick={sign}
            type="button"
          >
            {status === "signing" ? "Awaiting approval…" : "Sign flow approval"}
          </button>
        </div>
      </div>
    </section>
  );
}
