const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const { ccc } = require('@ckb-ccc/core');

test('the server-rendered connector waits for its client and discovers wallets after hydration', async () => {
  const reactEntry = require.resolve('@ckb-ccc/connector-react');
  const connectorEntry = require.resolve('@ckb-ccc/connector', { paths: [path.dirname(reactEntry)] });
  const { SignersController } = await import(pathToFileURL(path.join(path.dirname(connectorEntry), 'signers/index.js')));
  let discoveries = 0;
  let updates = 0;
  const host = {
    client: undefined,
    addController() {},
    refreshSigner() { updates += 1; },
    requestUpdate() {},
    signersController: {
      async refresh(client, onUpdate) {
        assert.equal(client.addressPrefix, 'ckt');
        discoveries += 1;
        onUpdate([{ name: 'Available wallet', signers: [] }]);
      },
    },
  };
  const controller = new SignersController(host);
  await controller.refresh();
  assert.equal(discoveries, 0);
  host.client = new ccc.ClientPublicTestnet();
  await controller.refresh();
  assert.equal(discoveries, 1);
  assert.equal(updates, 1);
  assert.equal(controller.wallets.length, 1);
});
