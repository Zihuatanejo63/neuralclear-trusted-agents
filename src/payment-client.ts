import { createHash } from "node:crypto";
import { AccountAddress, buildBasicAccountSigner } from "@concordium/web-sdk";
import {
  CONCORDIUM_TESTNET_CAIP2,
  getExplorerTxUrl,
  type ClientConcordiumSigner,
} from "@x402/concordium";
import { ExactConcordiumScheme } from "@x402/concordium/exact/client";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { canonicalStringify } from "./canonical.js";

/**
 * The payment leg: how one net settlement transfer is executed.
 *
 * The settlement engine depends only on this interface, so the demo can
 * run end-to-end offline and swap in the real x402-on-Concordium leg
 * without touching escrow / netting / receipt code.
 */

export interface SettlementPaymentRequest {
  /** Net payer account (base58check). */
  from: string;
  /** Net payee account (base58check). */
  to: string;
  /** Net amount, microCCD. */
  amountMicroCcd: bigint;
}

export interface SettlementPaymentResult {
  /** On-chain transaction hash; offline results are prefixed "offline:". */
  txHash: string;
  /** CCDExplorer URL for the transaction; undefined for offline results. */
  explorerUrl?: string;
  network: string;
}

export interface PaymentLeg {
  pay(request: SettlementPaymentRequest): Promise<SettlementPaymentResult>;
}

/**
 * Offline stand-in used by the offline demo. It does NOT move any
 * value: it derives a deterministic pseudo transaction hash from the
 * request so the rest of the loop (receipt binding, explorer field
 * handling) can be exercised honestly, clearly labelled as offline.
 */
export class OfflinePaymentLeg implements PaymentLeg {
  private counter = 0;

  async pay(request: SettlementPaymentRequest): Promise<SettlementPaymentResult> {
    this.counter += 1;
    const digest = createHash("sha256")
      .update(canonicalStringify({ ...request, counter: this.counter }))
      .digest("hex");
    return {
      txHash: `offline:${digest}`,
      network: CONCORDIUM_TESTNET_CAIP2,
    };
  }
}

export interface X402PaymentLegConfig {
  /** Base URL of our self-hosted facilitator service. */
  facilitatorBaseUrl: string;
  /**
   * Payer (sender) Ed25519 private key, 64 hex characters. Supplied by
   * the entry point from a key file; never logged, never persisted by
   * this class beyond the signer closure.
   */
  payerPrivateKey: string;
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

/**
 * Real x402 payment leg: settles one net transfer on Concordium
 * testnet as a sponsored V1 transaction through our self-hosted
 * facilitator (there is no official public facilitator for ccd).
 *
 * Flow (against the installed SDKs, web-sdk 12.1 / @x402 2.32):
 *   1. GET the facilitator's /supported and read extra.feePayer — the
 *      sponsor account the transaction must name.
 *   2. Build PaymentRequirements { scheme "exact", testnet CAIP-2,
 *      asset "" (native CCD), amount in microCCD, payTo, feePayer }.
 *   3. The client scheme (ExactConcordiumScheme, exact/client) builds
 *      the V1 sponsored SimpleTransfer, fetches the sender nonce from
 *      the chain, and signs the sender side with the payer key.
 *   4. POST /verify — the facilitator's SDK scheme checks all 9 rules
 *      against the chain; a rejection aborts before anything is sent.
 *   5. POST /settle — the facilitator adds the sponsor signature,
 *      submits, and waits for finalization; the returned transaction
 *      hash is mapped to its CCDExplorer URL.
 */
export class X402ConcordiumPaymentLeg implements PaymentLeg {
  constructor(private readonly config: X402PaymentLegConfig) {}

  async pay(request: SettlementPaymentRequest): Promise<SettlementPaymentResult> {
    const base = this.config.facilitatorBaseUrl.replace(/\/+$/, "");

    const supportedRes = await fetch(`${base}/supported`);
    if (!supportedRes.ok) {
      throw new Error(`GET ${base}/supported -> HTTP ${supportedRes.status}`);
    }
    const supported = (await supportedRes.json()) as SupportedResponse;
    const kind = supported.kinds.find(
      (k) => k.scheme === "exact" && k.network === CONCORDIUM_TESTNET_CAIP2,
    );
    const feePayer = kind?.extra?.feePayer;
    if (typeof feePayer !== "string" || feePayer === "") {
      throw new Error("facilitator /supported did not advertise a feePayer for the testnet exact kind");
    }

    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: CONCORDIUM_TESTNET_CAIP2,
      asset: "CCD", // native CCD — the SDK facilitator recognises native
      // CCD only by this exact asset id (an empty asset is read as a PLT
      // token id and rejected with asset_type_mismatch; live-verified)
      amount: request.amountMicroCcd.toString(),
      payTo: request.to,
      maxTimeoutSeconds: 600,
      extra: { feePayer },
    };

    const signer: ClientConcordiumSigner = {
      accountAddress: AccountAddress.fromBase58(request.from),
      signer: buildBasicAccountSigner(this.config.payerPrivateKey),
    };
    const scheme = new ExactConcordiumScheme(signer);
    const created = await scheme.createPaymentPayload(2, requirements);
    const paymentPayload: PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: created.payload,
    };

    const body = { x402Version: 2, paymentPayload, paymentRequirements: requirements };
    const verified = (await postJson(`${base}/verify`, body)) as VerifyResponse;
    if (!verified.isValid) {
      throw new Error(
        `facilitator /verify rejected the payment: ${verified.invalidReason ?? "unknown"}` +
          (verified.invalidMessage ? ` — ${verified.invalidMessage}` : ""),
      );
    }

    const settled = (await postJson(`${base}/settle`, body)) as SettleResponse;
    if (!settled.success || settled.transaction === "") {
      throw new Error(
        `facilitator /settle failed: ${settled.errorReason ?? "unknown"}` +
          (settled.errorMessage ? ` — ${settled.errorMessage}` : ""),
      );
    }

    return {
      txHash: settled.transaction,
      explorerUrl: getExplorerTxUrl(CONCORDIUM_TESTNET_CAIP2, settled.transaction),
      network: CONCORDIUM_TESTNET_CAIP2,
    };
  }
}

/** Helper: CCDExplorer URL for a settled transaction. */
export function explorerUrlFor(txHash: string): string | undefined {
  return getExplorerTxUrl(CONCORDIUM_TESTNET_CAIP2, txHash);
}
