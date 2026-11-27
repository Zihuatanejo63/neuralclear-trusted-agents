// Extract the CIS-8004 module schema (wasm "concordium-schema" custom section)
// from testnet and write it base64-encoded to schema-b64.txt.
import { ModuleReference } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import { writeFileSync } from 'node:fs';

const client = new ConcordiumGRPCNodeClient('grpc.testnet.concordium.com', 20000, credentials.createSsl());
const moduleRef = ModuleReference.fromHexString('0e57473715d1c2a364fa626b8783688db32b7fac9d0e2fc97043da91e1a7d3eb');
const ms = await client.getModuleSource(moduleRef);
const wasm = ms.source;

function readUleb(buf, off) {
  let result = 0, shift = 0;
  for (;;) { const b = buf[off++]; result |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
  return [result, off];
}
let schema = null;
{
  let off = 8;
  while (off < wasm.length) {
    const id = wasm[off++];
    let size; [size, off] = readUleb(wasm, off);
    const start = off;
    if (id === 0) {
      let nlen; [nlen, off] = readUleb(wasm, off);
      const name = Buffer.from(wasm.slice(off, off + nlen)).toString('utf8');
      if (name === 'concordium-schema') schema = wasm.slice(off + nlen, start + size);
    }
    off = start + size;
  }
}
if (!schema) { console.log('NO SCHEMA'); process.exit(2); }
writeFileSync('schema-b64.txt', Buffer.from(schema).toString('base64'));
console.log('wrote schema-b64.txt, schema bytes:', schema.length);
