import { detectConcordiumProvider, SchemaType } from '@concordium/browser-wallet-api-helpers';
import { AccountTransactionType, CcdAmount, ContractAddress, Energy, ReceiveName } from '@concordium/web-sdk';
// @ts-ignore JSON payloads built by the official MCP build_set_agent_uri tool
import buyerRaw from './seturi-buyer.json';
// @ts-ignore
import sellerRaw from './seturi-seller.json';
// @ts-ignore raw text: base64 module schema extracted from the on-chain CIS-8004 module
import schemaB64 from './schema-b64.txt';

const OWNER = '34sQTxEssRTT7rDHmsmyf5TPYAcNWV27x3hKsBagu9eKZjmoik';
let account: string | undefined;

const $ = (id: string) => document.getElementById(id)!;
function log(msg: string) {
  const el = $('log');
  el.textContent += (el.textContent ? '\n' : '') + msg;
}

async function ensureAccount(): Promise<string> {
  const provider = await detectConcordiumProvider();
  if (!account) {
    account = await provider.connect();
  }
  $('account').textContent = 'Connected account: ' + account +
    (account === OWNER ? '  ✓ this is the owner account' : '  ⚠ NOT the owner account — switch accounts in the wallet, then reload this page');
  return account!;
}

async function sign(raw: any, label: string) {
  try {
    const provider = await detectConcordiumProvider();
    const acct = await ensureAccount();
    if (acct !== OWNER) { log(label + ': aborted — connected account is not the owner.'); return; }
    const payload = {
      amount: CcdAmount.fromMicroCcd(0n),
      contractAddress: ContractAddress.create(12802n, 0n),
      receiveName: ReceiveName.fromString('CIS-8004.setAgentURI'),
      maxContractExecutionEnergy: Energy.create(30000n),
    };
    log(label + ': requesting signature in the wallet…');
    const txHash = await provider.sendTransaction(
      acct,
      AccountTransactionType.Update,
      payload,
      raw.parameter_json,
      { type: SchemaType.Module, value: (schemaB64 as unknown as string).trim() },
    );
    log(label + ': submitted ✓ tx hash = ' + txHash);
  } catch (e: any) {
    log(label + ': failed — ' + (e && e.message ? e.message : String(e)));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('connect').addEventListener('click', () => { ensureAccount().catch((e) => log('connect failed: ' + e.message)); });
  $('sign-buyer').addEventListener('click', () => sign(buyerRaw, 'Buyer #1541 setAgentURI'));
  $('sign-seller').addEventListener('click', () => sign(sellerRaw, 'Seller #1542 setAgentURI'));
});
