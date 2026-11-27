import type { NettingResult, NetTransfer, Obligation } from "./types.js";

/**
 * Netting engine — the core NeuralClear move: N metered micro-obligations
 * collapse into the minimal set of net transfers, and only those move
 * on-chain (one x402 payment per debtor->creditor pair in the demo).
 *
 * Algorithm: sum each account's position (received - owed), then greedily
 * match debtors to creditors. Ordering is fully deterministic (accounts
 * sorted lexicographically, largest amounts first within a side) so the
 * same obligation batch always produces the same settlement plan — the
 * property the signed receipt relies on.
 */
export function netObligations(obligations: readonly Obligation[]): NettingResult {
  const positions = new Map<string, bigint>();
  let grossMicroCcd = 0n;

  for (const obligation of obligations) {
    if (obligation.amountMicroCcd <= 0n) {
      throw new Error(`netting: obligation ${obligation.id} has non-positive amount`);
    }
    if (obligation.payer === obligation.payee) {
      throw new Error(`netting: obligation ${obligation.id} has payer === payee`);
    }
    grossMicroCcd += obligation.amountMicroCcd;
    positions.set(
      obligation.payer,
      (positions.get(obligation.payer) ?? 0n) - obligation.amountMicroCcd,
    );
    positions.set(
      obligation.payee,
      (positions.get(obligation.payee) ?? 0n) + obligation.amountMicroCcd,
    );
  }

  const byAmountDescThenAddress = (
    a: [string, bigint],
    b: [string, bigint],
  ): number => {
    const amtA = a[1] < 0n ? -a[1] : a[1];
    const amtB = b[1] < 0n ? -b[1] : b[1];
    if (amtA !== amtB) return amtA > amtB ? -1 : 1;
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  };

  const debtors = [...positions.entries()]
    .filter(([, pos]) => pos < 0n)
    .sort(byAmountDescThenAddress)
    .map(([account, pos]) => ({ account, remaining: -pos }));
  const creditors = [...positions.entries()]
    .filter(([, pos]) => pos > 0n)
    .sort(byAmountDescThenAddress)
    .map(([account, pos]) => ({ account, remaining: pos }));

  const transfers: NetTransfer[] = [];
  let netMicroCcd = 0n;
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const debtor = debtors[di];
    const creditor = creditors[ci];
    const amount =
      debtor.remaining < creditor.remaining ? debtor.remaining : creditor.remaining;
    transfers.push({ from: debtor.account, to: creditor.account, amountMicroCcd: amount });
    netMicroCcd += amount;
    debtor.remaining -= amount;
    creditor.remaining -= amount;
    if (debtor.remaining === 0n) di++;
    if (creditor.remaining === 0n) ci++;
  }

  return { positions, transfers, grossMicroCcd, netMicroCcd };
}
