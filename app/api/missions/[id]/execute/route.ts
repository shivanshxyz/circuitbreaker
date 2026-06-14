import type { DynamicEvmWalletClient } from "@dynamic-labs-wallet/node-evm";
import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex
} from "viem";
import { base } from "viem/chains";

import { createAuthenticatedDynamicClient } from "@/lib/dynamic/client";
import { signBroadcastAndWait } from "@/lib/dynamic/executor";
import { readStoredWalletMetadata } from "@/lib/dynamic/wallet-store";
import { readServerEnv, requireEnv } from "@/lib/env";
import { BASE_TOKENS } from "@/lib/evm/tokens";
import { getMission, updateMission } from "@/lib/mission/store";
import { evaluatePolicy } from "@/lib/policy/engine";

type DynamicWalletMetadata = Parameters<
  DynamicEvmWalletClient["signTransaction"]
>[0]["walletMetadata"];

const balanceOfAbi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }]
  }
] as const;

export const runtime = "nodejs";
const compact = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mission = getMission(id);
  if (!mission) {
    return NextResponse.json({ error: "Mission not found." }, { status: 404 });
  }
  if (mission.view.state === "EXECUTED") {
    return NextResponse.json(
      { error: "Mission has already executed." },
      { status: 409 }
    );
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const decision = evaluatePolicy({
    ...mission.policyInput,
    nowUnix,
    transactionHashAtExecution: mission.view.approval.flowHash
  });
  if (decision.outcome === "BLOCKED") {
    return NextResponse.json(
      { error: decision.reasons[0]?.message ?? "Policy blocked execution." },
      { status: 403 }
    );
  }
  if (decision.outcome === "LEDGER_REQUIRED" && !mission.ledgerSignature) {
    return NextResponse.json(
      { error: "Ledger approval is required before execution." },
      { status: 403 }
    );
  }

  try {
    const env = readServerEnv();
    requireEnv(env, [
      "DYNAMIC_AUTH_TOKEN",
      "DYNAMIC_ENVIRONMENT_ID",
      "DYNAMIC_WALLET_PASSWORD"
    ]);
    const storedMetadata = await readStoredWalletMetadata(
      env.DYNAMIC_WALLET_METADATA_PATH
    );
    if (!storedMetadata || !isAddress(storedMetadata.accountAddress)) {
      throw new Error("Dynamic wallet metadata is missing.");
    }
    const walletMetadata = storedMetadata as DynamicWalletMetadata;
    const account = storedMetadata.accountAddress as Address;
    const publicClient = createPublicClient({
      chain: base,
      transport: http(env.BASE_RPC_URL)
    });
    const [ethBalance, usdcBalance] = await Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.readContract({
        address: BASE_TOKENS.USDC,
        abi: balanceOfAbi,
        functionName: "balanceOf",
        args: [account]
      })
    ]);
    if (usdcBalance < mission.policyInput.amountUsdcAtomic) {
      throw new Error("The Dynamic wallet has insufficient USDC for this mission.");
    }
    if (ethBalance === 0n) {
      throw new Error("The Dynamic wallet has insufficient ETH for Base gas.");
    }

    const dynamicClient = await createAuthenticatedDynamicClient({
      environmentId: env.DYNAMIC_ENVIRONMENT_ID,
      authToken: env.DYNAMIC_AUTH_TOKEN
    });
    let nonce = await publicClient.getTransactionCount({
      address: account,
      blockTag: "pending"
    });
    const hashes: Hex[] = [];

    console.info(
      `[DYNAMIC] SIGNING | signer ${compact(account)} | Base | ${mission.approvals.length + 1} tx`
    );

    for (const approval of mission.approvals) {
      const receipt = await signBroadcastAndWait({
        dynamicClient,
        walletMetadata,
        password: env.DYNAMIC_WALLET_PASSWORD,
        rpcUrl: env.BASE_RPC_URL,
        transaction: approval,
        nonce
      });
      if (receipt.status !== "success") {
        throw new Error(`Token approval reverted: ${receipt.transactionHash}`);
      }
      hashes.push(receipt.transactionHash);
      nonce += 1;
    }

    const receipt = await signBroadcastAndWait({
      dynamicClient,
      walletMetadata,
      password: env.DYNAMIC_WALLET_PASSWORD,
      rpcUrl: env.BASE_RPC_URL,
      transaction: mission.transaction,
      nonce
    });
    if (receipt.status !== "success") {
      throw new Error(`Composer transaction reverted: ${receipt.transactionHash}`);
    }
    hashes.push(receipt.transactionHash);
    console.info(
      `[DYNAMIC] CONFIRMED | ${hashes.map(compact).join(", ")} | policy rechecked`
    );

    const updated = updateMission(id, (current) => ({
      ...current,
      view: {
        ...current.view,
        state: "EXECUTED",
        execution: { transactionHashes: hashes }
      }
    }));
    return NextResponse.json({ mission: updated?.view });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Execution failed." },
      { status: 400 }
    );
  }
}
