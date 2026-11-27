import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  CONCORDIUM_ADDRESS_REGEX,
  CONCORDIUM_TESTNET_CAIP2,
  MAX_EXPIRY_OFFSET_SECONDS,
  getConcordiumGrpcUrl,
  parseGrpcUrl,
  toConcordiumFacilitatorSigner,
  type ExactConcordiumPayloadV2,
  type SignableV1Transaction,
} from "@x402/concordium";
import { ExactConcordiumScheme } from "@x402/concordium/exact/facilitator";
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";

/**
 * Self-hosted x402 facilitator for Concordium testnet.
 *
 * There is no official public facilitator for the ccd network (findings
 * §2.3), so the demo hosts its own. The heavy lifting — sponsor signing,
 * submission, finalization, and the authoritative 9-rule verification —
 * is done by the official SDK scheme (`@x402/concordium/exact/facilitator`).
 * This module adds:
 *   1. an env-based factory for the SDK scheme (needs the facilitator
 *      account's private key — a 待密钥 step, never run in CI/demo);
 *   2. an offline pre-validation of the 9 verify rules that mirrors the
 *      SDK's checks as far as they can be decided without chain access,
 *      honestly marking the rules that require the chain;
 *   3. a minimal HTTP surface (GET /supported, POST /verify, POST /settle)
 *      delegating to the SDK scheme.
 */

export const FACILITATOR_NETWORK = CONCORDIUM_TESTNET_CAIP2;

/**
 * Creates the SDK facilitator scheme from environment variables:
 *   CCD_FACILITATOR_ADDRESS     sponsor account (base58check)
 *   CCD_FACILITATOR_PRIVATE_KEY sponsor Ed25519 private key, hex
 *
 * 待密钥步骤: throws when the key is absent. The facilitator account must
 * be a third account, independent of buyer and seller (verify Rule 9),
 * funded with a little test CCD to pay sponsored fees.
 */
export function createFacilitatorScheme(
  address: string,
  privateKey: string,
): ExactConcordiumScheme {
  const [host, port] = parseGrpcUrl(getConcordiumGrpcUrl(FACILITATOR_NETWORK));
  const signer = toConcordiumFacilitatorSigner(address, privateKey, {
    host,
    port,
    useTls: true,
    network: FACILITATOR_NETWORK,
  });
  return new ExactConcordiumScheme({
    signer,
    requireFinalization: true,
    finalizationTimeoutMs: 60_000,
    maxExpiryOffsetSeconds: MAX_EXPIRY_OFFSET_SECONDS,
  });
}

export function createFacilitatorSchemeFromEnv(): ExactConcordiumScheme {
  const address = process.env.CCD_FACILITATOR_ADDRESS;
  const privateKey = process.env.CCD_FACILITATOR_PRIVATE_KEY;
  if (!address || !privateKey) {
    throw new Error(
      "facilitator: CCD_FACILITATOR_ADDRESS / CCD_FACILITATOR_PRIVATE_KEY are not set. " +
        "This is a pending-key step: export the facilitator testnet account key from the wallet first.",
    );
  }
  return createFacilitatorScheme(address, privateKey);
}

// ---------------------------------------------------------------------------
// Offline pre-validation of the 9 verify rules (findings §2.2).
//
// The SDK's ExactConcordiumScheme.verify() is authoritative; this function
// exists so the demo and its logs can explain *why* a payload would pass
// or fail before any chain call, and so the rule set is explicit in our
// own code. Rules that cannot be decided offline are reported as
// "requires-chain", never guessed.
// ---------------------------------------------------------------------------

export type RuleStatus = "pass" | "fail" | "requires-chain";

export interface RuleCheck {
  /** Rule number 1..9, matching the order in findings §2.2. */
  rule: number;
  name: string;
  status: RuleStatus;
  detail: string;
}

function sponsorAddressOf(tx: SignableV1Transaction): string | undefined {
  return tx.header.sponsor.address ?? tx.header.sponsor.account;
}

/**
 * Validates a partially-signed sponsored V1 transaction against the
 * payment requirements, offline. `facilitatorAddress` is our sponsor
 * account; `nowSeconds` is injectable for tests.
 */
export function validateSponsoredTxOffline(
  tx: SignableV1Transaction,
  requirements: PaymentRequirements,
  facilitatorAddress: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RuleCheck[] {
  const checks: RuleCheck[] = [];
  const sender = tx.header.sender;
  const sponsor = sponsorAddressOf(tx);
  // The SDK facilitator recognises native CCD only when the asset id is
  // exactly "CCD" (case-insensitive); anything else — including "" — is
  // treated as a PLT token id (live-verified against the SDK scheme).
  const isCcd = requirements.asset.toUpperCase() === "CCD";
  const isTransfer = tx.payload.type === "transfer" || tx.payload.type === "transferWithMemo";

  // Rule 1 — transaction version must be exactly 1 (V1 sponsored format).
  checks.push({
    rule: 1,
    name: "version",
    status: tx.version === 1 ? "pass" : "fail",
    detail: `transaction version is ${tx.version}, must be 1`,
  });

  // Rule 2 — sender identity: the sender must be a real account whose
  // credential issued the signature. Offline we can only check the
  // address shape; existence/credential binding is on-chain.
  checks.push({
    rule: 2,
    name: "sender-identity",
    status: CONCORDIUM_ADDRESS_REGEX.test(sender) ? "requires-chain" : "fail",
    detail: CONCORDIUM_ADDRESS_REGEX.test(sender)
      ? "sender address is well-formed; credential binding must be confirmed on-chain"
      : `sender "${sender}" is not a well-formed Concordium address`,
  });

  // Rule 3 — the sponsor named in the transaction must be this facilitator.
  checks.push({
    rule: 3,
    name: "sponsor-is-facilitator",
    status: sponsor === facilitatorAddress ? "pass" : "fail",
    detail:
      sponsor === facilitatorAddress
        ? "sponsor matches the facilitator account"
        : `sponsor is ${sponsor ?? "<none>"}, facilitator is ${facilitatorAddress}`,
  });

  // Rule 4 — recipient must equal requirements.payTo. Decidable offline
  // for native CCD transfers; PLT recipients live inside CBOR operations.
  if (tx.payload.type === "transfer" || tx.payload.type === "transferWithMemo") {
    checks.push({
      rule: 4,
      name: "recipient-matches-payto",
      status: tx.payload.toAddress === requirements.payTo ? "pass" : "fail",
      detail: `transfer recipient ${tx.payload.toAddress}, payTo ${requirements.payTo}`,
    });
  } else {
    checks.push({
      rule: 4,
      name: "recipient-matches-payto",
      status: "requires-chain",
      detail: "PLT recipient is encoded in token operations; the SDK decodes it during verify",
    });
  }

  // Rule 5 — amount must equal requirements.amount exactly (atomic units).
  if (tx.payload.type === "transfer" || tx.payload.type === "transferWithMemo") {
    checks.push({
      rule: 5,
      name: "amount-exact",
      status: tx.payload.amount === requirements.amount ? "pass" : "fail",
      detail: `transfer amount ${tx.payload.amount}, required ${requirements.amount}`,
    });
  } else {
    checks.push({
      rule: 5,
      name: "amount-exact",
      status: "requires-chain",
      detail: "PLT amount is encoded in token operations; the SDK decodes it during verify",
    });
  }

  // Rule 6 — asset type must match requirements.asset.
  if (isCcd) {
    checks.push({
      rule: 6,
      name: "asset-type",
      status: isTransfer ? "pass" : "fail",
      detail: isTransfer
        ? "native CCD requirement carried by a simple transfer"
        : "native CCD requirement but payload is a token update",
    });
  } else {
    const ok = tx.payload.type === "tokenUpdate" && tx.payload.tokenId === requirements.asset;
    checks.push({
      rule: 6,
      name: "asset-type",
      status: ok ? "pass" : "fail",
      detail:
        tx.payload.type === "tokenUpdate"
          ? `token id ${tx.payload.tokenId}, required asset ${requirements.asset}`
          : `PLT requirement ${requirements.asset} but payload is ${tx.payload.type}`,
    });
  }

  // Rule 7 — expiry must be in the future and at most 600 s out.
  const offset = tx.header.expiry - nowSeconds;
  checks.push({
    rule: 7,
    name: "expiry-window",
    status: offset > 0 && offset <= MAX_EXPIRY_OFFSET_SECONDS ? "pass" : "fail",
    detail: `expiry is ${offset}s from now; allowed window is (0, ${MAX_EXPIRY_OFFSET_SECONDS}]`,
  });

  // Rule 8 — sender signature must verify against the on-chain credential.
  // Cryptographic verification needs the account's credential keys from
  // the chain (the SDK fetches account info for exactly this).
  const senderSigCount = Object.keys(tx.signatures.sender ?? {}).length;
  checks.push({
    rule: 8,
    name: "sender-signature",
    status: senderSigCount > 0 ? "requires-chain" : "fail",
    detail:
      senderSigCount > 0
        ? "sender signature slots are populated; cryptographic verification against the on-chain credential happens in the SDK verify"
        : "sender signature map is empty",
  });

  // Rule 9 — payload safety: a single operation, and the sponsor must be
  // neither the sender nor the recipient; the sponsor signature slot must
  // still be empty (the facilitator adds it at settle time).
  const safetyProblems: string[] = [];
  if (sponsor !== undefined && sponsor === sender) safetyProblems.push("sponsor equals sender");
  if (sponsor !== undefined && sponsor === requirements.payTo) {
    safetyProblems.push("sponsor equals recipient");
  }
  if (Object.keys(tx.signatures.sponsor ?? {}).length > 0) {
    safetyProblems.push("sponsor signature slot is already populated");
  }
  if (tx.payload.type === "tokenUpdate") {
    // "Exactly one operation" for PLT is encoded in the CBOR operations
    // string; the SDK decodes and enforces it. Not decidable offline.
    checks.push({
      rule: 9,
      name: "payload-safety",
      status: safetyProblems.length === 0 ? "requires-chain" : "fail",
      detail:
        safetyProblems.length === 0
          ? "sponsor separation holds; single-operation check for PLT operations is enforced by the SDK after CBOR decoding"
          : safetyProblems.join("; "),
    });
  } else {
    checks.push({
      rule: 9,
      name: "payload-safety",
      status: safetyProblems.length === 0 ? "pass" : "fail",
      detail:
        safetyProblems.length === 0
          ? "single transfer operation; sponsor is neither sender nor recipient; sponsor slot empty"
          : safetyProblems.join("; "),
    });
  }

  return checks;
}

/** Extracts the Concordium payload from an x402 PaymentPayload envelope. */
export function extractConcordiumPayload(
  payload: PaymentPayload,
): ExactConcordiumPayloadV2 {
  const inner = payload.payload as Partial<ExactConcordiumPayloadV2>;
  if (!inner || typeof inner !== "object" || !("signedTransaction" in inner)) {
    throw new Error("facilitator: payment payload does not carry a Concordium signedTransaction");
  }
  return inner as ExactConcordiumPayloadV2;
}

// ---------------------------------------------------------------------------
// Minimal HTTP surface over a facilitator scheme.
// Endpoints follow the x402 facilitator convention:
//   GET  /supported -> SupportedResponse
//   POST /verify    -> VerifyResponse   (body: VerifyRequest)
//   POST /settle    -> SettleResponse   (body: SettleRequest)
// The server is not started by this module; see startFacilitatorServer()
// and the runnable entry point in facilitator-service.ts.
// ---------------------------------------------------------------------------

/**
 * The slice of the SDK's SchemeNetworkFacilitator interface that the HTTP
 * surface actually calls. The SDK's ExactConcordiumScheme satisfies it
 * structurally; the keyless dry-run scheme in facilitator-service.ts
 * implements the same shape so the endpoints can be exercised offline.
 */
export interface FacilitatorSchemeLike {
  getExtra(network: Network): Record<string, unknown> | undefined;
  getSigners(network: string): string[];
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(text);
}

export function createFacilitatorServer(scheme: FacilitatorSchemeLike): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/supported") {
        const supported: SupportedResponse = {
          kinds: [
            {
              x402Version: 2,
              scheme: "exact",
              network: FACILITATOR_NETWORK,
              extra: scheme.getExtra(FACILITATOR_NETWORK),
            },
          ],
          extensions: [],
          signers: { "ccd:*": scheme.getSigners(FACILITATOR_NETWORK) },
        };
        sendJson(res, 200, supported);
        return;
      }
      if (req.method === "POST" && (req.url === "/verify" || req.url === "/settle")) {
        const body = (await readJsonBody(req)) as {
          paymentPayload: PaymentPayload;
          paymentRequirements: PaymentRequirements;
        };
        if (req.url === "/verify") {
          const result: VerifyResponse = await scheme.verify(
            body.paymentPayload,
            body.paymentRequirements,
          );
          sendJson(res, 200, result);
        } else {
          // settle() performs the on-chain submission: it adds the sponsor
          // signature, submits via the facilitator signer, and waits for
          // finalization (see SDK ExactConcordiumScheme.settle).
          const result: SettleResponse = await scheme.settle(
            body.paymentPayload,
            body.paymentRequirements,
          );
          sendJson(res, 200, result);
        }
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Starts the facilitator HTTP server. Requires a key-backed scheme. */
export function startFacilitatorServer(port: number): Server {
  const scheme = createFacilitatorSchemeFromEnv();
  const server = createFacilitatorServer(scheme);
  server.listen(port);
  return server;
}
