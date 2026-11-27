// Independent on-chain verification of the online demo settlement tx.
import { AccountAddress, TransactionHash } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';

const TX = 'd07bc4637b81ffab7114d31b545eb84305ed62b5e2cee5b716cd8d6f17405cfd';
const client = new ConcordiumGRPCNodeClient('grpc.testnet.concordium.com', 20000, credentials.createSsl());

const status = await client.getBlockItemStatus(TransactionHash.fromHexString(TX));
console.log('tx status type:', status.type);
const outcome = status.outcomes ? Object.values(status.outcomes)[0] : undefined;
if (outcome) {
  console.log('outcome status:', outcome.status.type ?? outcome.status);
  const tx = outcome.transaction;
  console.log('tx type:', tx?.transactionType, '| cost (microCCD):', tx?.cost?.toString());
  console.log('sender:', tx?.sender?.address);
  const events = outcome.summary?.events ?? tx?.events ?? [];
  console.log('events:', JSON.stringify(events, (k, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 600));
}
for (const [name, addr] of Object.entries({
  buyer: '4AyXSvvTXK5ke5ugxjq4gG9gEeqigiMWrKQkPA7jLVv1LQc454',
  seller: '4f4i45cB7TM97Y2C7jrGqmmHexkRntnRfP97abZxQoC2dJvLHm',
  facilitator: '4VzgocUC7rsycNdSdb7LcLx5CUxjXfKeszcEy3eQojtQGA62aR',
})) {
  const info = await client.getAccountInfo(AccountAddress.fromBase58(addr));
  console.log(name, 'balance (microCCD):', info.accountAmount.microCcdAmount.toString(), '| nonce:', info.accountNonce.toString());
}
