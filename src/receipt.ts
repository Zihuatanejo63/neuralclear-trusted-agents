import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalStringify } from "./canonical.js";

/**
 * Ed25519-signed settlement receipts.
 *
 * A receipt closes one netting batch: it binds the parties, the gross and
 * net amounts, the number of obligations collapsed, the audit chain's head
 * hash, and — once the x402 leg has run — the on-chain transaction hash
 * and its CCDExplorer URL. The settlement engine signs the canonical form
 * of the payload; anyone with the public key can verify.
 */

export interface ReceiptPayload {
  receiptId: string;
  /** Id of the netting batch this receipt closes. */
  batchId: string;
  /** Net payer (usually the buyer). */
  payer: string;
  /** Net payee (usually the seller). */
  payee: string;
  /** Gross volume of the batch before netting, microCCD. */
  grossMicroCcd: bigint;
  /** Amount actually settled on-chain, microCCD. */
  netMicroCcd: bigint;
  /** How many micro-obligations were collapsed into this settlement. */
  obligationsCount: number;
  /** Head hash of the audit chain at settlement time. */
  auditHeadHash: string;
  /** On-chain transaction hash of the x402 settlement; null in offline demo. */
  txHash: string | null;
  /** CCDExplorer transaction URL; null in offline demo. */
  explorerUrl: string | null;
  /** ISO-8601 issue time. */
  issuedAt: string;
}

export interface SignedReceipt {
  payload: ReceiptPayload;
  /** Signer's Ed25519 public key, raw 32 bytes, hex. */
  signerPublicKeyHex: string;
  /** Ed25519 signature over canonicalStringify(payload), base64. */
  signatureBase64: string;
}

function publicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return Buffer.from(jwk.x, "base64url").toString("hex");
}

export class ReceiptSigner {
  private constructor(
    private readonly privateKey: KeyObject,
    readonly publicKey: KeyObject,
  ) {}

  /** Generates a fresh Ed25519 key pair (demo engine identity). */
  static generate(): ReceiptSigner {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new ReceiptSigner(privateKey, publicKey);
  }

  /** This signer's public key, raw hex — publish it next to the receipts. */
  get publicKeyHex(): string {
    return publicKeyHex(this.publicKey);
  }

  /** Signs a receipt payload and returns the signed receipt. */
  sign(payload: ReceiptPayload): SignedReceipt {
    const data = Buffer.from(canonicalStringify(payload), "utf8");
    const signature = cryptoSign(null, data, this.privateKey);
    return {
      payload,
      signerPublicKeyHex: this.publicKeyHex,
      signatureBase64: signature.toString("base64"),
    };
  }
}

/** Verifies a signed receipt against the public key embedded in it. */
export function verifyReceipt(receipt: SignedReceipt): boolean {
  try {
    const raw = Buffer.from(receipt.signerPublicKeyHex, "hex");
    if (raw.length !== 32) return false;
    // Rebuild a KeyObject from the raw Ed25519 public key via JWK.
    const publicKey = createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
      format: "jwk",
    });
    const data = Buffer.from(canonicalStringify(receipt.payload), "utf8");
    return cryptoVerify(
      null,
      data,
      publicKey,
      Buffer.from(receipt.signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

/** SHA-256 over the canonical signed receipt — the receipt's own id-hash. */
export function receiptHash(receipt: SignedReceipt): string {
  return createHash("sha256").update(canonicalStringify(receipt)).digest("hex");
}
