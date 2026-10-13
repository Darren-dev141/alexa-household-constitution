'use strict';
// The recording path, driven by the same HTTP routes the phone page uses.
const test = require('node:test');
const assert = require('node:assert');
const { runLive } = require('../demo/live');

const KEY = 'live-test-code';
const owner = (base, p, m = 'GET') => fetch(base + p, { method: m, headers: { 'x-owner-key': KEY } }).then(r => r.json());

test('live mode: setup and the big order wait for the phone page; a parent "no" orders nothing', async () => {
  const seen = [];
  const r = await runLive({ ownerKey: KEY, log: () => {}, waitLimitMs: 5000, waitForOwner: async (what, base) => {
    const p = await owner(base, '/owner/pending');
    if (what === 'home setup') {
      assert.match(p.setup.say, /ask before spending more than \$75\.00/); seen.push('setup');
      assert.strictEqual((await owner(base, '/owner/approve-setup', 'POST')).status, 'applied');
    } else {
      assert.match(p.actions[0].what, /air fryer for \$89\.99/); seen.push('air fryer');
      assert.strictEqual((await owner(base, '/owner/decline/' + p.actions[0].id, 'POST')).status, 'declined');
    }
  } });
  assert.deepStrictEqual(seen, ['setup', 'air fryer'], 'both were shown on the phone page');
  assert.strictEqual(r.setUp, true);
  assert.strictEqual(r.airFryerOrdered, false);
  assert.deepStrictEqual(r.orders, ['1 × dish soap']);
  assert.strictEqual(r.chainOk, true);
});
