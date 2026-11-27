import { AuditChain } from "./audit-chain.js";
import { EscrowLedger } from "./escrow.js";
import { netObligations } from "./netting.js";
import type { PaymentLeg, SettlementPaymentResult } from "./payment-client.js";
import { ReceiptSigner, receiptHash, verifyReceipt, type ReceiptPayload } from "./receipt.js";
import type { Obligation } from "./types.js";

/**
 * The shared settlement loop behind both demo entry points
 * (src/demo.ts offline, src/demo-online.ts on testnet):
 *
 *   buyer deposits escrow for an order
 *   -> seller delivers metered micro-services (each delivery is an
 *      obligation + a hash-chained audit entry)
 *   -> obligations are netted (including a small seller->buyer rebate,
 *      so netting is genuinely two-sided)
 *   -> only the net amount is paid once through the injected payment leg
 *   -> escrow releases the net and refunds the remainder
 *   -> the engine issues an Ed25519-signed receipt bound to the audit
 *      chain head and to the payment transaction; both the chain and
 *      the receipt are verified before the summary is printed.
 *
 * The escrow ledger is NeuralClear's own book (who owes what, what is
 * held); the payment leg is the only part that moves value, and it is
 * injected: OfflinePaymentLeg in the offline demo, the real x402 leg
 * on testnet.
 */

export const DEMO_ORDER_ID = "order-demo-001";
export const DEMO_BATCH_ID = "batch-demo-001";

// Metered prices (microCCD): 0.05 CCD per price fetch, 0.12 CCD per
// daily summary, 0.03 CCD seller->buyer service rebate.
export const PRICE_FETCH = 50_000n;
export const PRICE_SUMMARY = 120_000n;
export const PRICE_REBATE = 30_000n;

export function formatCcd(microCcd: bigint): string {
  const whole = microCcd / 1_000_000n;
  const frac = (microCcd % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac} CCD`;
}

export interface SettlementLoopOptions {
  buyer: string;
  seller: string;
  paymentLeg: PaymentLeg;
  heading: string;
  /** Printed after the buyer line; explains what the accounts are. */
  accountsNote: string;
  /** Printed after the escrow deposit line; explains the funding. */
  fundingNote: string;
}

export interface SettlementLoopResult {
  payment: SettlementPaymentResult;
  receiptPayload: ReceiptPayload;
  auditEntries: number;
}

export async function runSettlementLoop(
  opts: SettlementLoopOptions,
): Promise<SettlementLoopResult> {
  const { buyer, seller, paymentLeg } = opts;
  const escrow = new EscrowLedger();
  const audit = new AuditChain();
  const engine = ReceiptSigner.generate();

  console.log(`== ${opts.heading} ==`);
  console.log(`buyer : ${buyer}`);
  console.log(`seller: ${seller}`);
  console.log(opts.accountsNote);
  console.log("");

  // 1. Buyer funds the ledger and deposits escrow for the order.
  escrow.credit(buyer, 5_000_000n); // 5 CCD on the engine's book
  const plannedSpend = 7n * PRICE_FETCH + 3n * PRICE_SUMMARY;
  escrow.openHold(DEMO_ORDER_ID, buyer, plannedSpend);
  audit.append("escrow.deposit", {
    orderId: DEMO_ORDER_ID,
    from: buyer,
    amountMicroCcd: plannedSpend,
  });
  console.log(`escrow deposit: ${formatCcd(plannedSpend)} held for ${DEMO_ORDER_ID}`);
  console.log(opts.fundingNote);

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
      orderId: DEMO_ORDER_ID,
      payer,
      payee,
      amountMicroCcd,
      service,
      deliveredAt: new Date().toISOString(),
    };
    obligations.push(obligation);
    audit.append("delivery", { ...obligation });
  };
  for (let i = 0; i < 7; i++) deliver("fetch-ccd-eur-price", buyer, seller, PRICE_FETCH);
  for (let i = 0; i < 3; i++) deliver("summarise-ccd-day", buyer, seller, PRICE_SUMMARY);
  for (let i = 0; i < 2; i++) deliver("service-rebate", seller, buyer, PRICE_REBATE);
  console.log(`deliveries: ${obligations.length} micro-obligations recorded in the audit chain`);

  // 3. Netting: collapse the batch into the minimal settlement plan.
  const netting = netObligations(obligations);
  audit.append("settlement.net", {
    batchId: DEMO_BATCH_ID,
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

  // 4. Settle the net amount once through the payment leg.
  const payment = await paymentLeg.pay({
    from: transfer.from,
    to: transfer.to,
    amountMicroCcd: transfer.amountMicroCcd,
  });
  console.log(`payment leg: tx ${payment.txHash} on ${payment.network}`);
  if (payment.explorerUrl) {
    console.log(`explorer   : ${payment.explorerUrl}`);
  }

  // 5. Escrow mirrors the settlement: release the net, refund the rest.
  escrow.releaseHold(DEMO_ORDER_ID, seller, transfer.amountMicroCcd);
  audit.append("escrow.release", {
    orderId: DEMO_ORDER_ID,
    to: seller,
    amountMicroCcd: transfer.amountMicroCcd,
    txHash: payment.txHash,
  });
  const buyerBeforeRefund = escrow.availableBalance(buyer);
  escrow.refundHold(DEMO_ORDER_ID);
  const refunded = escrow.availableBalance(buyer) - buyerBeforeRefund;
  audit.append("escrow.refund", {
    orderId: DEMO_ORDER_ID,
    to: buyer,
    amountMicroCcd: refunded,
  });
  console.log(`escrow: released ${formatCcd(transfer.amountMicroCcd)}, refunded ${formatCcd(refunded)}`);

  // 6. Issue the signed receipt, bound to the audit chain head.
  const payload: ReceiptPayload = {
    receiptId: `rcpt-${DEMO_BATCH_ID}`,
    batchId: DEMO_BATCH_ID,
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
  console.log(`balances (engine book): buyer ${formatCcd(escrow.availableBalance(buyer))}, seller ${formatCcd(escrow.availableBalance(seller))}`);
  if (!chainOk || !receiptOk) {
    throw new Error("demo invariant broken: verification failed");
  }
  console.log("");
  console.log(JSON.stringify(receipt, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  return { payment, receiptPayload: payload, auditEntries: audit.entries().length };
}
