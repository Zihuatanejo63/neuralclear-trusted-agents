/**
 * Shared domain types for the NeuralClear minimal settlement loop.
 *
 * All CCD amounts are microCCD (1 CCD = 1_000_000 microCCD, 6 decimals),
 * carried as bigint end-to-end so netting never loses precision.
 * Account identifiers are Concordium base58check addresses as plain
 * strings; format validation happens at the chain boundary (facilitator),
 * not in the off-chain ledger.
 */

/** A single metered micro-obligation created by one service delivery. */
export interface Obligation {
  /** Unique obligation id (also the audit-chain entry key). */
  id: string;
  /** Order this delivery belongs to. */
  orderId: string;
  /** Account that owes the money (the buyer of the service). */
  payer: string;
  /** Account that earned the money (the seller of the service). */
  payee: string;
  /** Amount owed, in microCCD. Must be > 0. */
  amountMicroCcd: bigint;
  /** Skill / service that was delivered, e.g. "fetch-ccd-eur-price". */
  service: string;
  /** ISO-8601 timestamp of the delivery. */
  deliveredAt: string;
}

/** One net settlement transfer produced by the netting engine. */
export interface NetTransfer {
  from: string;
  to: string;
  amountMicroCcd: bigint;
}

/** Result of netting a batch of obligations. */
export interface NettingResult {
  /** Net position per account: positive = should receive, negative = should pay. */
  positions: Map<string, bigint>;
  /** Minimal set of transfers that settles every position. */
  transfers: NetTransfer[];
  /** Sum of all obligation amounts (gross volume before netting). */
  grossMicroCcd: bigint;
  /** Sum of the net transfers (what actually moves on-chain). */
  netMicroCcd: bigint;
}
