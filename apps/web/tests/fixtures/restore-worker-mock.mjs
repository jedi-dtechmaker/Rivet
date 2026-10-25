import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const originalExecFile = childProcess.execFile;
childProcess.execFile = function (command, args, options, callback) {
  if (command === 'git' && args.includes('push')) {
    const rewritten = [...args];
    rewritten[rewritten.length - 1] = process.env.RIVET_TEST_DESTINATION;
    return originalExecFile(command, rewritten, options, callback);
  }
  return originalExecFile(command, args, options, callback);
};
syncBuiltinESMExports();

globalThis.fetch = async (url, options = {}) => {
  if (url === 'https://api.github.com/user') {
    assert.equal(options.headers.Authorization, `Bearer ${process.env.GH_TOKEN}`);
    return new Response(JSON.stringify({ login: 'test-account' }));
  }
  if (url === 'https://api.github.com/user/repos') {
    assert.equal(options.method, 'POST');
    assert.equal(JSON.parse(options.body).private, false);
    return new Response(JSON.stringify({ html_url: 'https://github.com/test-account/restored' }), { status: 201 });
  }
  if (String(url).includes('/ipfs/') || String(url).includes('.ipfs.')) {
    if (String(url).includes('gateway.pinata.cloud')) assert.equal(options.headers.Authorization, `Bearer ${process.env.PINATA_JWT}`);
    return new Response(readFileSync(process.env.RIVET_TEST_BUNDLE));
  }
  throw new Error('Unexpected outbound request in restore test');
};
