import { AuditChain } from "./audit-chain.js";
import { EscrowLedger } from "./escrow.js";
import { netObligations } from "./netting.js";
import { OfflinePaymentLeg, type PaymentLeg } from "./payment-client.js";
import { ReceiptSigner, receiptHash, verifyReceipt, type ReceiptPayload } from "./receipt.js";
import type { Obligation } from "./types.js";

/**
 * End-to-end demo of the minimal settlement loop (offline, no keys, no
 * chain — the on-chain leg is injected via PaymentLeg):
 *
 *   buyer opens an order and deposits escrow
 *   -> seller delivers metered micro-services (each delivery is an
 *      obligation + a hash-chained audit entry)
 *   -> obligations are netted (including a small seller->buyer rebate,
 *      so netting is genuinely two-sided)
 *   -> only the net amount is "paid" once through the payment leg
 *   -> escrow releases the net and refunds the remainder
 *   -> the engine issues an Ed25519-signed receipt bound to the audit
 *      chain head; both the chain and the receipt are verified.
 *
 * Run: npm run demo
 */

// The buyer is the user's verified testnet account (findings §1).
// 待回填: the seller account does not exist yet — it is one of the three
// testnet accounts the user still has to create (see progress doc). The
// offline ledger treats addresses as opaque strings, so a labelled
// placeholder is used and must be replaced before any on-chain run.
const BUYER = "34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik";
const SELLER = "SELLER_ACCOUNT_PENDING_CREATION";

const ORDER_ID = "order-demo-001";
const BATCH_ID = "batch-demo-001";

// Metered prices (microCCD): 0.05 CCD per price fetch, 0.12 CCD per
// daily summary, 0.03 CCD seller->buyer service rebate.
const PRICE_FETCH = 50_000n;
const PRICE_SUMMARY = 120_000n;
const PRICE_REBATE = 30_000n;

function formatCcd(microCcd: bigint): string {
  const whole = microCcd / 1_000_000n;
  const frac = (microCcd % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac} CCD`;
}

async function main(): Promise<void> {
  const escrow = new EscrowLedger();
  const audit = new AuditChain();
  const paymentLeg: PaymentLeg = new OfflinePaymentLeg();
  const engine = ReceiptSigner.generate();

  console.log("== NeuralClear for Trusted Agents — offline loop demo ==");
  console.log(`buyer : ${BUYER}`);
  console.log(`seller: ${SELLER} (placeholder, account not yet created)`);
  console.log("");

  // 1. Buyer funds the ledger and deposits escrow for the order.
  //    (In the on-chain form this is the buyer's deposit step; here the
  //    ledger credit stands in for it, labelled as demo funding.)
  escrow.credit(BUYER, 5_000_000n); // 5 CCD demo funding
  const plannedSpend = 7n * PRICE_FETCH + 3n * PRICE_SUMMARY;
  escrow.openHold(ORDER_ID, BUYER, plannedSpend);
  audit.append("escrow.deposit", {
    orderId: ORDER_ID,
    from: BUYER,
    amountMicroCcd: plannedSpend,
  });
  console.log(`escrow deposit: ${formatCcd(plannedSpend)} held for ${ORDER_ID}`);

  // 2. Seller delivers metered micro-services; each delivery creates an
  //    obligation and an audit-chain entry. Two seller->buyer rebates
  //    make the batch genuinely two-sided.
  const obligations: Obligation[] = [];
  const deliver = (
    service: string,
    payer: string,
    payee: string,
    amountMicroCcd: bigint,
  ): void => {
    const obligation: Obligation = {
      id: `obl-${obligations.length + 1}`,
      orderId: ORDER_ID,
      payer,
      payee,
      amountMicroCcd,
      service,
      deliveredAt: new Date().toISOString(),
    };
    obligations.push(obligation);
    audit.append("delivery", { ...obligation });
  };
  for (let i = 0; i < 7; i++) deliver("fetch-ccd-eur-price", BUYER, SELLER, PRICE_FETCH);
  for (let i = 0; i < 3; i++) deliver("summarise-ccd-day", BUYER, SELLER, PRICE_SUMMARY);
  for (let i = 0; i < 2; i++) deliver("service-rebate", SELLER, BUYER, PRICE_REBATE);
  console.log(`deliveries: ${obligations.length} micro-obligations recorded in the audit chain`);

  // 3. Netting: collapse the batch into the minimal settlement plan.
  const netting = netObligations(obligations);
  audit.append("settlement.net", {
    batchId: BATCH_ID,
    grossMicroCcd: netting.grossMicroCcd,
    netMicroCcd: netting.netMicroCcd,
    transfers: netting.transfers,
  });
  console.log(
    `netting: gross ${formatCcd(netting.grossMicroCcd)} -> net ${formatCcd(netting.netMicroCcd)} ` +
      `in ${netting.transfers.length} transfer(s)`,
  );
  if (netting.transfers.length !== 1) {
    throw new Error(`demo invariant broken: expected exactly 1 net transfer, got ${netting.transfers.length}`);
  }
  const transfer = netting.transfers[0];

  // 4. Settle the net amount once through the payment leg (offline here;
  //    X402ConcordiumPaymentLeg is the phase-3 drop-in replacement).
  const payment = await paymentLeg.pay({
    from: transfer.from,
    to: transfer.to,
    amountMicroCcd: transfer.amountMicroCcd,
  });
  console.log(`payment leg: tx ${payment.txHash} on ${payment.network}`);

  // 5. Escrow mirrors the settlement: release the net, refund the rest.
  escrow.releaseHold(ORDER_ID, SELLER, transfer.amountMicroCcd);
  audit.append("escrow.release", {
    orderId: ORDER_ID,
    to: SELLER,
    amountMicroCcd: transfer.amountMicroCcd,
    txHash: payment.txHash,
  });
  const buyerBeforeRefund = escrow.availableBalance(BUYER);
  escrow.refundHold(ORDER_ID);
  const refunded = escrow.availableBalance(BUYER) - buyerBeforeRefund;
  audit.append("escrow.refund", {
    orderId: ORDER_ID,
    to: BUYER,
    amountMicroCcd: refunded,
  });
  console.log(`escrow: released ${formatCcd(transfer.amountMicroCcd)}, refunded ${formatCcd(refunded)}`);

  // 6. Issue the signed receipt, bound to the audit chain head.
  const payload: ReceiptPayload = {
    receiptId: `rcpt-${BATCH_ID}`,
    batchId: BATCH_ID,
    payer: transfer.from,
    payee: transfer.to,
    grossMicroCcd: netting.grossMicroCcd,
    netMicroCcd: netting.netMicroCcd,
    obligationsCount: obligations.length,
    auditHeadHash: audit.headHash(),
    txHash: payment.txHash,
    explorerUrl: payment.explorerUrl ?? null,
    issuedAt: new Date().toISOString(),
  };
  const receipt = engine.sign(payload);
  audit.append("receipt.issued", {
    receiptId: payload.receiptId,
    receiptHash: receiptHash(receipt),
  });

  // 7. Verify everything, then print the summary.
  const chainOk = audit.verify();
  const receiptOk = verifyReceipt(receipt);
  console.log("");
  console.log(`audit chain: ${audit.entries().length} entries, verify = ${chainOk}`);
  console.log(`receipt    : ${payload.receiptId}, verify = ${receiptOk}, hash = ${receiptHash(receipt)}`);
  console.log(`balances   : buyer ${formatCcd(escrow.availableBalance(BUYER))}, seller ${formatCcd(escrow.availableBalance(SELLER))}`);
  if (!chainOk || !receiptOk) {
    throw new Error("demo invariant broken: verification failed");
  }
  console.log("");
  console.log(JSON.stringify(receipt, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
