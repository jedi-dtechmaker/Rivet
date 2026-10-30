import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

// Public chain data only: deliberately do not load application environment files.
const { values } = parseArgs({ options: {
  rpc: { type: 'string', default: 'https://testnet.ckb.dev/' },
  transaction: { type: 'string', default: '0x2aa15bc36a911eb0f565a6b2820c4df8ebbf7ff2b73d4cc70d9ffa27bc4936d2' },
  output: { type: 'string' },
  'include-secp': { type: 'boolean', default: false },
  'include-spore': { type: 'boolean', default: false },
} });

async function main() {
  if (!values.output) throw new Error('Specify --output /tmp/rivet-cota-fixture.json. Existing files are never overwritten.');
  if (!/^0x[0-9a-f]{64}$/i.test(values.transaction)) throw new Error('Invalid transaction hash.');
  const endpoint = new URL(values.rpc);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('RPC must use HTTP or HTTPS.');
  let requestId = 0;
  async function rpc(method, params) {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`RPC ${method}: HTTP ${response.status}`);
    const body = await response.json();
    if (body.error) throw new Error(`RPC ${method}: ${body.error.code}`);
    return body.result;
  }
  const transactions = new Map();
  async function transaction(hash) {
    if (!transactions.has(hash)) transactions.set(hash, (async () => {
      const result = await rpc('get_transaction', [hash]);
      if (result?.tx_status?.status !== 'committed' || !result.transaction?.outputs) {
        throw new Error(`Transaction is not committed or available: ${hash}`);
      }
      return result.transaction;
    })());
    return transactions.get(hash);
  }
  async function cell(outPoint) {
    const tx = await transaction(outPoint.tx_hash);
    const index = Number(BigInt(outPoint.index));
    if (!Number.isSafeInteger(index) || !tx.outputs[index] || tx.outputs_data[index] === undefined) {
      throw new Error('Invalid referenced output.');
    }
    return { output: tx.outputs[index], data: tx.outputs_data[index] };
  }
  const tx = await transaction(values.transaction);
  if (tx.inputs.length !== 1 || tx.header_deps.length !== 0) {
    throw new Error('Use a single-input identity update without header dependencies.');
  }
  const source = await cell(tx.inputs[0].previous_output);
  const cotaHash = '0x89cd8003a0eaf8e65e0c31525b7d1d5c1becefd2ea75bb4cff87810ae37764d8';
  const joyidHash = '0xd23761b364210735c19c60561d213fb3beae2fd6172743719eff6920e020baac';
  if (source.output.type?.code_hash !== cotaHash || source.output.type.hash_type !== 'type'
    || source.output.lock.code_hash !== joyidHash || source.output.lock.hash_type !== 'type'
    || !/^0x02[0-9a-f]{64}$/i.test(source.data)) {
    throw new Error('Source must be a testnet JoyID-owned CoTA identity cell.');
  }
  if (source.data !== `0x02${'00'.repeat(32)}`) {
    throw new Error('This compatibility regression requires an initially empty CoTA SMT.');
  }
  // Add only public code dependencies for an offline application-owner simulation.
  // This modified transaction is a fixture, not another committed transaction.
  const fixtureTx = { ...tx, cell_deps: [...tx.cell_deps] };
  if (values['include-spore']) {
    const { ccc } = await import('@ckb-ccc/core');
    const { getSporeScriptInfo } = await import('@ckb-ccc/spore');
    const info = getSporeScriptInfo(new ccc.ClientPublicTestnet());
    for (const { cellDep } of info.cellDeps) fixtureTx.cell_deps.push({
      out_point: { tx_hash: cellDep.outPoint.txHash, index: `0x${cellDep.outPoint.index.toString(16)}` }, dep_type: cellDep.depType,
    });
  }
  if (values['include-secp']) {
    const secpGroup = { out_point: { tx_hash: '0xf8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37', index: '0x0' }, dep_type: 'dep_group' };
    if (!fixtureTx.cell_deps.some(dependency => dependency.out_point.tx_hash === secpGroup.out_point.tx_hash && BigInt(dependency.out_point.index) === 0n)) {
      fixtureTx.cell_deps.push(secpGroup);
    }
  }
  const dependencies = new Map();
  async function addDependency(outPoint) {
    const key = `${outPoint.tx_hash}:${Number(BigInt(outPoint.index))}`;
    if (!dependencies.has(key)) dependencies.set(key, { cell_dep: { out_point: outPoint, dep_type: 'code' }, ...await cell(outPoint) });
    return dependencies.get(key);
  }
  for (const dependency of fixtureTx.cell_deps) {
    const resolved = await addDependency(dependency.out_point);
    if (dependency.dep_type === 'dep_group') {
      resolved.cell_dep.dep_type = 'dep_group';
      const data = Buffer.from(resolved.data.slice(2), 'hex');
      if (data.length < 4 || data.length !== 4 + data.readUInt32LE(0) * 36) throw new Error('Invalid dependency group.');
      for (let offset = 4; offset < data.length; offset += 36) {
        await addDependency({ tx_hash: `0x${data.subarray(offset, offset + 32).toString('hex')}`, index: `0x${data.readUInt32LE(offset + 32).toString(16)}` });
      }
    } else if (dependency.dep_type !== 'code') throw new Error('Unsupported dependency type.');
  }
  const fixture = {
    mock_info: { inputs: [{ input: tx.inputs[0], ...source }], cell_deps: [...dependencies.values()], header_deps: [] },
    tx: fixtureTx,
  };
  await writeFile(values.output, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`Saved public testnet fixture with ${dependencies.size} dependency cells to ${values.output}`);
  console.log(`Source transaction: ${values.transaction}`);
  if (values['include-secp']) console.log('Includes additional public secp dependencies for offline owner simulations.');
  console.log('No wallet, database, signature request, or transaction broadcast was used.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
