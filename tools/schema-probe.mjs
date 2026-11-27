// Probe: fetch the CIS-8004 module schema from testnet and verify that
// serializeUpdateContractParameters reproduces the MCP parameter_hex exactly.
import { ModuleReference, ContractName, EntrypointName, serializeUpdateContractParameters, Parameter } from '@concordium/web-sdk';
import { ConcordiumGRPCNodeClient, credentials } from '@concordium/web-sdk/nodejs';
import { readFileSync } from 'node:fs';

const client = new ConcordiumGRPCNodeClient('grpc.testnet.concordium.com', 20000, credentials.createSsl());

const moduleRef = ModuleReference.fromHexString('0e57473715d1c2a364fa626b8783688db32b7fac9d0e2fc97043da91e1a7d3eb');
const ms = await client.getModuleSource(moduleRef);
const wasm = ms.source;
console.log('wasm bytes:', wasm.length);

// Extract the "concordium-schema" custom section from the wasm module.
function readUleb(buf, off) {
  let result = 0, shift = 0;
  for (;;) { const b = buf[off++]; result |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
  return [result, off];
}
let schema = null;
{
  let off = 8; // skip wasm magic + version
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
if (!schema) { console.log('NO concordium-schema section found'); process.exit(2); }
const schemaBytes = schema instanceof Uint8Array ? schema : new Uint8Array(schema);
console.log('schema bytes:', schemaBytes.length);
console.log('schema base64:', Buffer.from(schemaBytes).toString('base64'));

const payload = JSON.parse(readFileSync(process.argv[2], 'utf8')); // {parameter_json, parameter_hex}
const param = serializeUpdateContractParameters(
  ContractName.fromString('CIS-8004'),
  EntrypointName.fromString('setAgentURI'),
  payload.parameter_json,
  schemaBytes.buffer.slice(schemaBytes.byteOffset, schemaBytes.byteOffset + schemaBytes.byteLength),
);
const hex = Parameter.toHexString(param);
console.log('serialized == MCP parameter_hex:', hex === payload.parameter_hex);
if (hex !== payload.parameter_hex) {
  console.log('mine:', hex.slice(0, 80));
  console.log('mcp :', payload.parameter_hex.slice(0, 80));
}
