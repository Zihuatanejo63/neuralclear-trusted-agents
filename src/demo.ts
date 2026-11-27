import { OfflinePaymentLeg } from "./payment-client.js";
import { runSettlementLoop } from "./settlement-loop.js";

/**
 * Offline entry point: the full settlement loop with the offline
 * payment leg (no keys, no chain). The accounts named are the real
 * testnet demo accounts; offline they are only labels on the engine's
 * book — no value moves. For the on-chain run see src/demo-online.ts.
 *
 * Run: npm run demo
 */

// The demo accounts on Concordium testnet (see docs/progress phase 4):
// buyer and seller are the two registered CIS-8004 demo agents; the
// registry owner (34sQTx…) is a separate role and is not the payer.
const BUYER = "4AyXSvvTXK5ke5ugxjq4gG9gEeqigiMWrKQkPA7jLVv1LQc454";
const SELLER = "4f4i45cB7TM97Y2C7jrGqmmHexkRntnRfP97abZxQoC2dJvLHm";

async function main(): Promise<void> {
  await runSettlementLoop({
    buyer: BUYER,
    seller: SELLER,
    paymentLeg: new OfflinePaymentLeg(),
    heading: "NeuralClear for Trusted Agents — offline loop demo",
    accountsNote: "(real testnet demo accounts, used as labels only in offline mode)",
    fundingNote: "(offline: the 5 CCD credit is the engine's book entry, no chain funds move)",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
