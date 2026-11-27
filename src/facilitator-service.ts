import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { SignableV1Transaction } from "@x402/concordium";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { canonicalStringify } from "./canonical.js";
import {
  FACILITATOR_NETWORK,
  createFacilitatorScheme,
  createFacilitatorServer,
  extractConcordiumPayload,
  validateSponsoredTxOffline,
  type FacilitatorSchemeLike,
} from "./facilitator.js";
import { netObligations } from "./netting.js";
import type { Obligation } from "./types.js";

/**
 * Runnable entry point for the self-hosted x402 facilitator service
 * (the HTTP surface itself lives in facilitator.ts).
 *
 * There is no official public facilitator for the ccd network (findings
 * §2.3), so the demo runs its own. Two modes:
 *
 *   live (default)  Delegates /verify and /settle to the official SDK
 *                   scheme, which adds the sponsor signature, submits
 *                   the sponsored V1 transaction and waits for
 *                   finalization. Sponsoring spends the facilitator
 *                   account's own CCD on fees, so live mode REFUSES to
 *                   start without the facilitator private key, read from
 *                   a key file (never from argv, never logged).
 *
 *   --dry-run       Keyless, chainless shape check. Starts the same HTTP
 *                   surface on an ephemeral port backed by an offline
 *                   scheme (verify = the 9-rule offline pre-validation
 *                   from facilitator.ts; settle = a deterministic
 *                   "dry-run:"-prefixed pseudo transaction id, mirroring
 *                   OfflinePaymentLeg's "offline:" convention), then
 *                   drives it with the offline demo's netting result:
 *                   GET /supported, POST /verify (plus a tampered-amount
 *                   negative probe), POST /settle. Exits non-zero if any
 *                   response shape or value is off.
 *
 * Configuration (environment variables):
 *   FACILITATOR_ADDRESS  sponsor account, base58check (live: required;
 *                        dry-run: optional, a labelled placeholder is
 *                        used so the sponsor-separation rules still run)
 *   FACILITATOR_KEY_FILE path to a file holding the facilitator Ed25519
 *                        private key as 64 hex characters (live only)
 *   PORT                 listen port for live mode (default 4022;
 *                        dry-run always uses an ephemeral port)
 *
 * Run: npm run facilitator          (live; needs address + key file)
 *      npm run facilitator:dry-run  (offline shape check)
 */

const DEFAULT_PORT = 4022;

interface ServiceConfig {
  dryRun: boolean;
  port: number;
  address?: string;
  keyFile?: string;
}

function loadConfig(argv: string[], env: NodeJS.ProcessEnv): ServiceConfig {
  const rawPort = env.PORT;
  let port = DEFAULT_PORT;
  if (rawPort !== undefined && rawPort !== "") {
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `facilitator-service: PORT "${rawPort}" is not a valid TCP port (1-65535)`,
      );
    }
  }
  return {
    dryRun: argv.includes("--dry-run"),
    port,
    address: env.FACILITATOR_ADDRESS || undefined,
    keyFile: env.FACILITATOR_KEY_FILE || undefined,
  };
}

// ---------------------------------------------------------------------------
// Live mode
// ---------------------------------------------------------------------------

/**
 * Reads and shape-checks the facilitator private key from the configured
 * key file. Throws with an explicit refusal message when the file is not
 * configured, unreadable, or does not hold a 64-hex-character Ed25519
 * private key. The key itself is never logged or returned anywhere else.
 */
function readFacilitatorKey(config: ServiceConfig): string {
  if (!config.keyFile) {
    throw new Error(
      "facilitator-service: refusing to start in live mode: FACILITATOR_KEY_FILE is not set. " +
        "Live mode sponsors testnet transactions and needs the facilitator account's Ed25519 " +
        "private key in a file (export it from the wallet for the facilitator testnet account). " +
        "For a keyless check of the endpoint shapes, run with --dry-run instead.",
    );
  }
  let raw: string;
  try {
    raw = readFileSync(config.keyFile, "utf8");
  } catch {
    throw new Error(
      `facilitator-service: refusing to start in live mode: cannot read FACILITATOR_KEY_FILE ` +
        `"${config.keyFile}" (missing or unreadable). Export the facilitator testnet account ` +
        "key from the wallet into that file first.",
    );
  }
  const key = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `facilitator-service: refusing to start in live mode: "${config.keyFile}" does not contain ` +
        "a 64-hex-character Ed25519 private key (surrounding whitespace is allowed).",
    );
  }
  return key;
}

function startLive(config: ServiceConfig): void {
  if (!config.address) {
    throw new Error(
      "facilitator-service: refusing to start in live mode: FACILITATOR_ADDRESS is not set. " +
        "Set it to the facilitator (sponsor) testnet account address — a third account, " +
        "independent of buyer and seller (verify Rule 9).",
    );
  }
  const key = readFacilitatorKey(config);
  const scheme = createFacilitatorScheme(config.address, key);
  const server = createFacilitatorServer(scheme);
  server.listen(config.port, () => {
    console.log(`facilitator service (live) listening on http://127.0.0.1:${config.port}`);
    console.log(`network    : ${FACILITATOR_NETWORK}`);
    console.log(`facilitator: ${config.address} (sponsor; key loaded from file, never logged)`);
    console.log("endpoints  : GET /supported, POST /verify, POST /settle");
  });
}

// ---------------------------------------------------------------------------
// Dry-run mode: an offline FacilitatorSchemeLike + a self-driving client.
//
// The dry-run scheme never signs and never touches the chain. verify()
// runs the offline 9-rule pre-validation and maps it onto VerifyResponse:
// any rule decided "fail" offline makes the payload invalid; rules marked
// "requires-chain" (sender identity binding, sender signature crypto) are
// reported in the driver's log and do not block the shape round trip —
// in live mode the SDK scheme decides them against the chain.
// ---------------------------------------------------------------------------

class DryRunFacilitatorScheme implements FacilitatorSchemeLike {
  constructor(private readonly facilitatorAddress: string) {}

  getExtra(_network: Network): Record<string, unknown> | undefined {
    // Same shape as the SDK scheme: { feePayer }.
    return { feePayer: this.facilitatorAddress };
  }

  getSigners(_network: string): string[] {
    return [this.facilitatorAddress];
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const outcome = this.checkOffline(payload, requirements);
    if (!outcome.ok) {
      return {
        isValid: false,
        invalidReason: outcome.reason,
        invalidMessage: outcome.message,
        payer: outcome.payer,
      };
    }
    return { isValid: true, payer: outcome.payer };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verification = await this.verify(payload, requirements);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        errorMessage: verification.invalidMessage,
        payer: verification.payer,
        transaction: "",
        network: requirements.network,
      };
    }
    const digest = createHash("sha256")
      .update(canonicalStringify({ paymentPayload: payload, paymentRequirements: requirements }))
      .digest("hex");
    return {
      success: true,
      payer: verification.payer,
      // Clearly labelled pseudo id — no transaction exists. Mirrors
      // OfflinePaymentLeg's "offline:" prefix convention.
      transaction: `dry-run:${digest}`,
      network: requirements.network,
      amount: requirements.amount,
    };
  }

  private checkOffline(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ):
    | { ok: true; payer: string }
    | { ok: false; reason: string; message: string; payer?: string } {
    let tx: SignableV1Transaction;
    try {
      tx = extractConcordiumPayload(payload).signedTransaction;
    } catch (err) {
      return {
        ok: false,
        reason: "malformed_payload",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const checks = validateSponsoredTxOffline(tx, requirements, this.facilitatorAddress);
    const failed = checks.find((c) => c.status === "fail");
    if (failed) {
      return {
        ok: false,
        reason: `rule_${failed.rule}_${failed.name}`,
        message: failed.detail,
        payer: tx.header.sender,
      };
    }
    return { ok: true, payer: tx.header.sender };
  }
}

// The dry-run scenario mirrors the offline demo batch (src/demo.ts): the
// registered testnet buyer/seller demo-agent accounts (labels only in
// dry-run mode), the same 12 metered obligations, netted to a single
// transfer of 650_000 microCCD.
const DRY_RUN_BUYER = "4AyXSvvTXK5ke5ugxjq4gG9gEeqigiMWrKQkPA7jLVv1LQc454";
const DRY_RUN_SELLER = "4f4i45cB7TM97Y2C7jrGqmmHexkRntnRfP97abZxQoC2dJvLHm";
const DRY_RUN_FACILITATOR_FALLBACK = "FACILITATOR_ACCOUNT_PENDING_CREATION";

function buildDryRunScenario(facilitatorAddress: string): {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
  tx: SignableV1Transaction;
} {
  const obligations: Obligation[] = [];
  const deliver = (
    service: string,
    payer: string,
    payee: string,
    amountMicroCcd: bigint,
  ): void => {
    obligations.push({
      id: `obl-${obligations.length + 1}`,
      orderId: "order-demo-001",
      payer,
      payee,
      amountMicroCcd,
      service,
      deliveredAt: new Date().toISOString(),
    });
  };
  for (let i = 0; i < 7; i++) deliver("fetch-ccd-eur-price", DRY_RUN_BUYER, DRY_RUN_SELLER, 50_000n);
  for (let i = 0; i < 3; i++) deliver("summarise-ccd-day", DRY_RUN_BUYER, DRY_RUN_SELLER, 120_000n);
  for (let i = 0; i < 2; i++) deliver("service-rebate", DRY_RUN_SELLER, DRY_RUN_BUYER, 30_000n);

  const netting = netObligations(obligations);
  if (netting.transfers.length !== 1) {
    throw new Error(
      `dry-run scenario broken: expected exactly 1 net transfer, got ${netting.transfers.length}`,
    );
  }
  const transfer = netting.transfers[0];

  const paymentRequirements: PaymentRequirements = {
    scheme: "exact",
    network: FACILITATOR_NETWORK,
    asset: "CCD", // native CCD (the SDK facilitator's exact asset id for it)
    amount: transfer.amountMicroCcd.toString(),
    payTo: transfer.to,
    maxTimeoutSeconds: 600,
    extra: { feePayer: facilitatorAddress },
  };

  const tx: SignableV1Transaction = {
    version: 1,
    header: {
      sender: transfer.from,
      nonce: 1,
      expiry: Math.floor(Date.now() / 1000) + 300,
      numSignatures: 1,
      sponsor: { address: facilitatorAddress, numSignatures: 0 },
    },
    payload: {
      type: "transfer",
      toAddress: transfer.to,
      amount: transfer.amountMicroCcd.toString(),
    },
    signatures: {
      // Placeholder bytes: structurally a credential signature map, NOT a
      // real signature, and never presented as one — Rule 8 (cryptographic
      // verification against the on-chain credential) stays
      // "requires-chain" in the dry-run report by design.
      sender: { "0": { "0": "00".repeat(64) } },
      sponsor: {},
    },
  };

  const paymentPayload: PaymentPayload = {
    x402Version: 2,
    accepted: paymentRequirements,
    payload: { signedTransaction: tx },
  };
  return { paymentPayload, paymentRequirements, tx };
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function expect(condition: boolean, label: string): void {
  if (!condition) {
    throw new Error(`dry-run assertion failed: ${label}`);
  }
  console.log(`  ok: ${label}`);
}

async function runDryRun(config: ServiceConfig): Promise<void> {
  const facilitatorAddress = config.address ?? DRY_RUN_FACILITATOR_FALLBACK;
  const { paymentPayload, paymentRequirements, tx } = buildDryRunScenario(facilitatorAddress);

  console.log("== facilitator service — dry run (no keys, no chain) ==");
  console.log(`network    : ${FACILITATOR_NETWORK}`);
  console.log(`facilitator: ${facilitatorAddress} (sponsor)`);
  console.log(
    `scenario   : demo batch netted to 1 transfer of ${paymentRequirements.amount} microCCD, ` +
      `${paymentRequirements.payTo} <- ${tx.header.sender}`,
  );
  console.log("");
  console.log("offline 9-rule pre-validation of the scenario payload:");
  for (const check of validateSponsoredTxOffline(tx, paymentRequirements, facilitatorAddress)) {
    console.log(`  rule ${check.rule} ${check.name}: ${check.status} — ${check.detail}`);
  }
  console.log("");

  const server = createFacilitatorServer(new DryRunFacilitatorScheme(facilitatorAddress));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}`;
  try {
    console.log(`HTTP round trip against ${base}:`);

    const supportedRes = await fetch(`${base}/supported`);
    if (!supportedRes.ok) {
      throw new Error(`GET /supported -> HTTP ${supportedRes.status}`);
    }
    const supported = (await supportedRes.json()) as SupportedResponse;
    expect(supported.kinds.length === 1, "GET /supported returns exactly 1 kind");
    expect(supported.kinds[0].scheme === "exact", "supported kind scheme is exact");
    expect(
      supported.kinds[0].network === FACILITATOR_NETWORK,
      "supported kind network is the testnet CAIP-2",
    );
    expect(
      supported.kinds[0].extra?.feePayer === facilitatorAddress,
      "supported kind extra.feePayer is the facilitator account",
    );
    expect(
      supported.signers["ccd:*"]?.length === 1 &&
        supported.signers["ccd:*"][0] === facilitatorAddress,
      "supported signers list the facilitator account under ccd:*",
    );

    const requestBody = { x402Version: 2, paymentPayload, paymentRequirements };
    const verified = (await postJson(`${base}/verify`, requestBody)) as VerifyResponse;
    expect(verified.isValid === true, "POST /verify accepts the scenario payload");
    expect(verified.payer === tx.header.sender, "verify response payer is the buyer (sender)");

    const tampered: PaymentRequirements = {
      ...paymentRequirements,
      amount: (BigInt(paymentRequirements.amount) + 1n).toString(),
    };
    const rejected = (await postJson(`${base}/verify`, {
      x402Version: 2,
      paymentPayload,
      paymentRequirements: tampered,
    })) as VerifyResponse;
    expect(rejected.isValid === false, "POST /verify rejects a tampered amount (rule 5)");
    expect(
      rejected.invalidReason === "rule_5_amount-exact",
      "rejection reason names rule 5 (amount-exact)",
    );

    const settled = (await postJson(`${base}/settle`, requestBody)) as SettleResponse;
    expect(settled.success === true, "POST /settle reports success");
    expect(
      settled.transaction.startsWith("dry-run:"),
      "settle transaction id is labelled dry-run: (no real transaction exists)",
    );
    expect(settled.network === FACILITATOR_NETWORK, "settle response network is the testnet CAIP-2");
    expect(settled.amount === paymentRequirements.amount, "settle amount matches the net amount");
    expect(settled.payer === tx.header.sender, "settle response payer is the buyer (sender)");

    console.log("");
    console.log("dry run passed: /supported, /verify (+ negative probe) and /settle shapes round-trip.");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(
    [
      "Usage: node dist/facilitator-service.js [--dry-run]",
      "",
      "  (no flags)  live mode — requires FACILITATOR_ADDRESS and FACILITATOR_KEY_FILE",
      "  --dry-run   keyless offline shape check of /supported, /verify, /settle",
      "",
      "Environment: FACILITATOR_ADDRESS, FACILITATOR_KEY_FILE, PORT (default 4022)",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const config = loadConfig(argv, process.env);
  if (config.dryRun) {
    await runDryRun(config);
    return;
  }
  startLive(config);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
