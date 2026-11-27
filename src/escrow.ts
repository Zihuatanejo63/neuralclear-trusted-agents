/**
 * In-memory escrow ledger (demo口径).
 *
 * In the hackathon demo, escrow is an off-chain ledger: the buyer's funds
 * are *accounted for* here, while the actual value transfer happens once,
 * for the net amount, through the x402 payment leg. The production form
 * (custodial accounts / on-chain escrow contract) is described in the
 * path-to-production document, not implemented here.
 *
 * State machine per hold: OPEN -> RELEASED | REFUNDED. Any other
 * transition throws. Balances can never go negative.
 */

export type HoldStatus = "OPEN" | "RELEASED" | "REFUNDED";

export interface EscrowHold {
  orderId: string;
  /** Account that funded the hold. */
  from: string;
  amountMicroCcd: bigint;
  status: HoldStatus;
}

export class EscrowLedger {
  private readonly available = new Map<string, bigint>();
  private readonly holds = new Map<string, EscrowHold>();

  /** Credits an account (demo funding / refund landing / release landing). */
  credit(account: string, amountMicroCcd: bigint): void {
    this.assertPositive(amountMicroCcd);
    this.available.set(account, this.availableBalance(account) + amountMicroCcd);
  }

  /** Current spendable balance held in the ledger for an account. */
  availableBalance(account: string): bigint {
    return this.available.get(account) ?? 0n;
  }

  /** Amount currently locked in OPEN holds funded by an account. */
  heldBalance(account: string): bigint {
    let sum = 0n;
    for (const hold of this.holds.values()) {
      if (hold.from === account && hold.status === "OPEN") {
        sum += hold.amountMicroCcd;
      }
    }
    return sum;
  }

  /**
   * Moves funds from an account's available balance into an escrow hold
   * for one order. One OPEN hold per order.
   */
  openHold(orderId: string, from: string, amountMicroCcd: bigint): EscrowHold {
    this.assertPositive(amountMicroCcd);
    const existing = this.holds.get(orderId);
    if (existing && existing.status === "OPEN") {
      throw new Error(`escrow: order ${orderId} already has an OPEN hold`);
    }
    const balance = this.availableBalance(from);
    if (balance < amountMicroCcd) {
      throw new Error(
        `escrow: insufficient available balance for ${from}: have ${balance}, need ${amountMicroCcd}`,
      );
    }
    this.available.set(from, balance - amountMicroCcd);
    const hold: EscrowHold = { orderId, from, amountMicroCcd, status: "OPEN" };
    this.holds.set(orderId, hold);
    return hold;
  }

  /**
   * Releases part or all of an OPEN hold to a payee's available balance.
   * A partial release keeps the remainder in the hold; releasing the full
   * remaining amount closes the hold as RELEASED.
   *
   * In the settlement loop this mirrors the net x402 payment: the ledger
   * release amount must equal the on-chain net transfer amount.
   */
  releaseHold(orderId: string, to: string, amountMicroCcd: bigint): EscrowHold {
    this.assertPositive(amountMicroCcd);
    const hold = this.requireOpenHold(orderId);
    if (amountMicroCcd > hold.amountMicroCcd) {
      throw new Error(
        `escrow: release ${amountMicroCcd} exceeds hold ${hold.amountMicroCcd} for order ${orderId}`,
      );
    }
    hold.amountMicroCcd -= amountMicroCcd;
    if (hold.amountMicroCcd === 0n) {
      hold.status = "RELEASED";
    }
    this.credit(to, amountMicroCcd);
    return hold;
  }

  /** Refunds whatever remains in an OPEN hold back to its funder. */
  refundHold(orderId: string): EscrowHold {
    const hold = this.requireOpenHold(orderId);
    const remaining = hold.amountMicroCcd;
    hold.amountMicroCcd = 0n;
    hold.status = "REFUNDED";
    if (remaining > 0n) {
      this.credit(hold.from, remaining);
    }
    return hold;
  }

  /** Looks up a hold by order id. */
  getHold(orderId: string): EscrowHold | undefined {
    return this.holds.get(orderId);
  }

  private requireOpenHold(orderId: string): EscrowHold {
    const hold = this.holds.get(orderId);
    if (!hold) {
      throw new Error(`escrow: no hold for order ${orderId}`);
    }
    if (hold.status !== "OPEN") {
      throw new Error(`escrow: hold for order ${orderId} is ${hold.status}, not OPEN`);
    }
    return hold;
  }

  private assertPositive(amountMicroCcd: bigint): void {
    if (amountMicroCcd <= 0n) {
      throw new Error(`escrow: amount must be positive, got ${amountMicroCcd}`);
    }
  }
}
