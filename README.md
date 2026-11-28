# NeuralClear for Trusted Agents

**An escrow clearing desk for agent-to-agent micro-transactions on Concordium** — it only
trades with agents holding a *Verified by Concordium* badge, meters every micro-delivery
into a hash-chained audit log, nets the batch off-chain, and pays only the net amount,
once, via x402.

> ⚠️ **Testnet demonstration for the Concordium Trusted Agents Hackathon (Encode Club).**
> This is not a production payment product: it has no customers and no live volume, and all
> amounts are testnet CCD with no real-world value. The escrow in this demo is a testnet
> ledger implementation.

## Why

Agent-to-agent payments are tiny but fees are not. Measured on Concordium testnet,
sponsoring a single payment cost **4.997954 CCD** in fees — about 7.7× the 0.65 CCD payment
it carried. Paying twelve micro-invoices one by one buries the work in fees. NeuralClear
meters the twelve, nets them to one obligation, and settles exactly once.

## How it works

1. Two demo agents (buyer / seller) are registered in the **Agent Registry**, each with an
   ERC-8004 **Agent Card** and a *Verified by Concordium* badge.
2. Before trading, each side verifies the other's badge (`check_badge`); a missing or
   revoked badge means no trade.
3. The buyer places an order and funds **escrow** (testnet CCD).
4. The seller delivers 12 metered micro-services; every delivery is written into a
   **hash-chained audit log** (record-keeping trail).
5. Obligations are **netted**: gross 0.77 CCD collapses to a single net of **0.65 CCD**,
   paid once via **x402** (`@x402/concordium`, exact scheme, sponsored V1 transaction)
   through a **self-hosted facilitator** (there is no public one) — a third, independent
   account sponsors the fee.
6. Escrow releases the net and refunds the remainder; the engine issues an
   **Ed25519-signed receipt** bound to the audit chain's head.

**Concordium components used:** Concordium ID (testnet identity anchor), Agent Registry +
Verified by Concordium badge (CIS-8004 / CIS-8), x402 payments, sponsored transactions,
Agent Registry MCP Server.

## Live evidence (testnet)

| Item | Value |
|---|---|
| Buyer agent | token **1541** · `JyP9Tyu5zXyZApVf1b6Pd` · card: [`cards/buyer-agent-card.json`](cards/buyer-agent-card.json) |
| Seller agent | token **1542** · `JyP9TzzZvZUUzwjU1nwu4` · card: [`cards/seller-agent-card.json`](cards/seller-agent-card.json) |
| Badge check | `badge_valid = true` for both agents; every pass/fail check green, no issues |
| Net settlement tx | [`d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd`](https://ccdexplorer.io/testnet/transaction/d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd) — finalized, 0.65 CCD buyer → seller, sponsor fee 4.997954 CCD paid once by the facilitator |
| Same tx on CCDScan | https://testnet.ccdscan.io/transaction/d07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd |
| Registry | https://testnet-agent-registry.concordium.com/dashboard (contract #12802) |

Phase-by-phase records with independently re-verified chain data are in
[`docs/`](docs/) (`progress-2026-11-27-phase4-registration.md`,
`progress-2026-11-27-phase5-online-settlement.md`). The demo page is
[`demo/index.html`](demo/index.html); the demo video storyboard is
[`docs/demo-video-storyboard.md`](docs/demo-video-storyboard.md).

## Status

- ✅ Settlement core: escrow ledger, hash chain, netting engine, Ed25519 receipts (TypeScript, `npm run build` clean)
- ✅ Offline end-to-end demo passes (`npm run demo`): audit chain and receipt both verify
- ✅ Agent Cards generated via the official registry MCP, hosted byte-for-byte in this repo (SHA-256 verified)
- ✅ On-chain registration (buyer 1541, seller 1542) with card hashes pinned via `setAgentURI`
- ✅ Badges valid for both agents
- ✅ Self-hosted x402 facilitator settled the batch live on testnet (transaction above)
- ✅ Demo video (1:56, under the 3-minute limit)
- ⬜ Hackathon submission on Encode Club (deadline 2026-12-09 23:59 UTC)

## Run it

```bash
npm install
npm run build
npm run demo          # offline loop: escrow -> metering -> netting -> receipt
npm run demo:online   # same batch settled live via the self-hosted facilitator
                      # (requires BUYER_KEY_FILE and FACILITATOR_URL; see docs/)
```

## Path to production

What it would take to run this on mainnet, in front of real users — fee economics measured
from the live run, facilitator operations, custody and dispute handling — is in
[`docs/path-to-production.md`](docs/path-to-production.md).

## Layout

```
src/    settlement core (escrow / hash chain / netting / x402 leg / receipts / facilitator)
cards/  the two agents' ERC-8004 Agent Cards (byte-identical to the registered URIs)
demo/   static demo page for one full settlement round
docs/   findings, phase records, path to production, video storyboard
tools/  local signer page used to pin the card hashes on-chain
```
