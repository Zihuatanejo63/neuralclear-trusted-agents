import { createHash } from "node:crypto";
import {
  CONCORDIUM_TESTNET_CAIP2,
  getExplorerTxUrl,
} from "@x402/concordium";
import { canonicalStringify } from "./canonical.js";

/**
 * The payment leg: how one net settlement transfer is executed.
 *
 * The settlement engine depends only on this interface, so the demo can
 * run end-to-end offline today and swap in the real x402-on-Concordium
 * leg later without touching escrow / netting / receipt code.
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
 * Offline stand-in used by the demo and tests. It does NOT move any
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

/**
 * Real x402 payment leg (phase 3 — not wired yet).
 *
 * Intended flow, against the installed SDK (v2.32.0 type definitions):
 *   1. Build the buyer signer:
 *        import { buildBasicAccountSigner, AccountAddress } from "@concordium/web-sdk";
 *        const signer: ClientConcordiumSigner = {
 *          accountAddress: AccountAddress.fromBase58(CCD_ADDRESS),
 *          signer: buildBasicAccountSigner(CCD_PRIVATE_KEY),
 *        };
 *   2. const scheme = new ExactConcordiumScheme(signer)   // @x402/concordium/exact/client
 *   3. Ask our facilitator's GET /supported for the feePayer, build
 *      PaymentRequirements { scheme: "exact", network: testnet CAIP-2,
 *      asset: "CCD", amount, payTo } and enhance them with the server
 *      scheme's enhancePaymentRequirements() so extra.feePayer is set.
 *   4. const { payload } = await scheme.createPaymentPayload(2, requirements)
 *      — builds the V1 sponsored SimpleTransfer, signs the sender side.
 *   5. POST { paymentPayload, paymentRequirements } to the facilitator's
 *      /verify then /settle; the facilitator adds the sponsor signature,
 *      submits, and waits for finalization.
 *   6. Map SettleResponse.transaction through getExplorerTxUrl().
 *
 * 待密钥步骤: step 1 needs the buyer account's Ed25519 private key
 * (CCD_PRIVATE_KEY) and step 5 needs the facilitator service running
 * with its own key. Until both exist, pay() throws instead of faking
 * a settlement.
 */
export class X402ConcordiumPaymentLeg implements PaymentLeg {
  constructor(private readonly facilitatorBaseUrl: string) {}

  async pay(_request: SettlementPaymentRequest): Promise<SettlementPaymentResult> {
    throw new Error(
      `X402ConcordiumPaymentLeg (${this.facilitatorBaseUrl}): on-chain settlement is not wired yet. ` +
        "Pending-key step: it needs the buyer testnet private key (CCD_PRIVATE_KEY) and the " +
        "facilitator service running with CCD_FACILITATOR_PRIVATE_KEY. Use OfflinePaymentLeg for the demo.",
    );
  }
}

/** Helper for the real leg: CCDExplorer URL for a settled transaction. */
export function explorerUrlFor(txHash: string): string | undefined {
  return getExplorerTxUrl(CONCORDIUM_TESTNET_CAIP2, txHash);
}
