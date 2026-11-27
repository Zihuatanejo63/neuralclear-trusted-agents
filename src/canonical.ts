/**
 * Deterministic JSON stringify: object keys sorted recursively, bigint
 * encoded as a decimal string with a "n:" prefix marker is NOT used here —
 * callers must convert bigints before canonicalising (see toCanonicalValue).
 *
 * Used by the audit chain and the receipt signer so that hashes and
 * signatures are stable regardless of key insertion order.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(toCanonicalValue(value));
}

/** Converts a value into a JSON-safe, deterministically ordered structure. */
export function toCanonicalValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toCanonicalValue);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = toCanonicalValue(v);
  }
  return out;
}
