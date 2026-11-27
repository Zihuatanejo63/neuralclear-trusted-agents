import { createHash } from "node:crypto";
import { canonicalStringify } from "./canonical.js";

/**
 * Hash-chained audit log (record-keeping leg of the loop).
 *
 * Every delivery / order / settlement event is appended as an entry whose
 * SHA-256 hash covers the previous entry's hash plus the canonical form
 * of its own content, so any later edit breaks the chain detectably.
 * The head hash of this chain is what gets bound into the signed receipt,
 * tying the off-chain audit trail to the on-chain settlement.
 */

export type AuditEntryKind =
  | "order.opened"
  | "escrow.deposit"
  | "delivery"
  | "settlement.net"
  | "escrow.release"
  | "escrow.refund"
  | "receipt.issued";

export interface AuditEntry {
  /** 0-based sequence number; entry 0 is the genesis entry. */
  seq: number;
  kind: AuditEntryKind;
  /** ISO-8601 timestamp. */
  at: string;
  /** Entry payload (must be JSON-serialisable; bigints allowed). */
  data: Record<string, unknown>;
  /** Hash of the previous entry ("0".repeat(64) for the genesis entry). */
  prevHash: string;
  /** sha256(prevHash + canonical({seq, kind, at, data})), hex. */
  hash: string;
}

const GENESIS_PREV_HASH = "0".repeat(64);

function hashEntry(
  prevHash: string,
  seq: number,
  kind: AuditEntryKind,
  at: string,
  data: Record<string, unknown>,
): string {
  const body = canonicalStringify({ seq, kind, at, data });
  return createHash("sha256").update(prevHash).update(body).digest("hex");
}

export class AuditChain {
  private readonly chain: AuditEntry[] = [];

  constructor() {
    this.append("order.opened", { genesis: true, note: "audit chain created" });
  }

  /** Appends an entry and returns it (with its computed hash). */
  append(kind: AuditEntryKind, data: Record<string, unknown>): AuditEntry {
    const seq = this.chain.length;
    const prevHash = seq === 0 ? GENESIS_PREV_HASH : this.chain[seq - 1].hash;
    const at = new Date().toISOString();
    const hash = hashEntry(prevHash, seq, kind, at, data);
    const entry: AuditEntry = { seq, kind, at, data, prevHash, hash };
    this.chain.push(entry);
    return entry;
  }

  /** All entries, in order (read-only view). */
  entries(): readonly AuditEntry[] {
    return this.chain;
  }

  /** Hash of the most recent entry — the value bound into receipts. */
  headHash(): string {
    return this.chain[this.chain.length - 1].hash;
  }

  /** Recomputes every hash and linkage; true iff the chain is intact. */
  verify(): boolean {
    for (let i = 0; i < this.chain.length; i++) {
      const entry = this.chain[i];
      const expectedPrev = i === 0 ? GENESIS_PREV_HASH : this.chain[i - 1].hash;
      if (entry.prevHash !== expectedPrev) return false;
      if (entry.seq !== i) return false;
      if (hashEntry(entry.prevHash, entry.seq, entry.kind, entry.at, entry.data) !== entry.hash) {
        return false;
      }
    }
    return true;
  }
}
