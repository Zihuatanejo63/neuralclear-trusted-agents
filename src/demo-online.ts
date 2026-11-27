import { readFileSync } from "node:fs";
import { X402ConcordiumPaymentLeg } from "./payment-client.js";
import { runSettlementLoop } from "./settlement-loop.js";

/**
 * Online entry point: the same settlement loop as the offline demo,
 * but the net transfer really settles on Concordium testnet through
 * our self-hosted x402 facilitator (sponsored V1 transaction; the
 * facilitator pays the fee, the buyer pays the net amount).
 *
 * Prerequisites:
 *   - the facilitator service running in live mode
 *     (npm run facilitator, with FACILITATOR_ADDRESS +
 *      FACILITATOR_KEY_FILE for the sponsor account);
 *   - the buyer account's private key in a local key file.
 *
 * Configuration (environment variables):
 *   BUYER_KEY_FILE   path to a file holding the buyer Ed25519 private
 *                    key as 64 hex characters (required; read from the
 *                    file only, never from argv, never logged)
 *   FACILITATOR_URL  facilitator base URL (default http://127.0.0.1:4022)
 *
 * Run: npm run demo:online
 */

// The registered CIS-8004 demo agents on testnet (phase 4): the buyer
// agent pays, the seller agent receives. The facilitator is a third,
// independent account (x402 verify rule 9).
const BUYER = "4AyXSvvTXK5ke5ugxjq4gG9gEeqigiMWrKQkPA7jLVv1LQc454";
const SELLER = "4f4i45cB7TM97Y2C7jrGqmmHexkRntnRfP97abZxQoC2dJvLHm";
const FACILITATOR = "4VzgocUC7rsycNdSdb7LcLx5CUxjXfKeszcEy3eQojtQGA62aR";

function readBuyerKey(): string {
  const keyFile = process.env.BUYER_KEY_FILE;
  if (!keyFile) {
    throw new Error(
      "demo-online: BUYER_KEY_FILE is not set. Point it at the file holding the buyer " +
        "testnet account's Ed25519 private key (64 hex characters).",
    );
  }
  let raw: string;
  try {
    raw = readFileSync(keyFile, "utf8");
  } catch {
    throw new Error(`demo-online: cannot read BUYER_KEY_FILE "${keyFile}" (missing or unreadable).`);
  }
  const key = raw.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`demo-online: "${keyFile}" does not contain a 64-hex-character Ed25519 private key.`);
  }
  return key;
}

async function main(): Promise<void> {
  const facilitatorUrl = process.env.FACILITATOR_URL || "http://127.0.0.1:4022";
  const paymentLeg = new X402ConcordiumPaymentLeg({
    facilitatorBaseUrl: facilitatorUrl,
    payerPrivateKey: readBuyerKey(),
  });

  await runSettlementLoop({
    buyer: BUYER,
    seller: SELLER,
    paymentLeg,
    heading: "NeuralClear for Trusted Agents — ONLINE loop demo (Concordium testnet)",
    accountsNote: `(registered CIS-8004 demo agents; facilitator/sponsor: ${FACILITATOR})`,
    fundingNote:
      "(the escrow ledger above is the engine's book; the net amount below really moves " +
      "on testnet via a facilitator-sponsored x402 transaction)",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
