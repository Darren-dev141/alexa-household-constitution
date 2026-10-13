'use strict';
// End-to-end over real Streamable HTTP with the official MCP client.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createApp } = require('../src/server');

test('MCP over Streamable HTTP: setup, quiet order, ask-first order, refusal, owner-only loosening', async () => {
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hcmcp-'));
  const { app, home } = createApp({ dataDir, ownerKey: 'owner-secret' });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  try {
    assert.strictEqual(client.getServerVersion().name, 'household-promises');
    const tools = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepStrictEqual(tools, ['change_promise', 'confirm_action', 'finish_setup', 'place_order', 'read_promises', 'send_message', 'start_setup', 'what_did_you_do']);
    assert.ok(!tools.some(t => /approve|owner|token/.test(t)), 'no approval path is an MCP tool');

    const setup = await call('finish_setup', { home_type: 'family', ask_first_amount: 'seventy five dollars', allergies: 'peanuts and tree nuts', trusted_contacts: 'mom' });
    assert.match(setup, /always ask before spending more than \$75\.00/);

    const o = { item: 'oat milk', quantity: 1 };
    assert.strictEqual(await call('place_order', o), 'Done.');
    assert.strictEqual(home.sent.length, 1);
    assert.strictEqual(home.sent[0].unitCents, 1899, 'price came from the store, not the assistant');

    const ask = await call('place_order', { item: 'oat milk', quantity: 5 });
    assert.match(ask, /\$94\.95/); assert.strictEqual(home.sent.length, 1, 'nothing ordered before yes');
    const id = ask.match(/with id ([0-9a-f]+)/)[1];
    assert.match(await call('confirm_action', { id, their_words: 'yes' }), /Here's what I did: order 5/);
    assert.strictEqual(home.sent.length, 2);
    assert.match(await call('confirm_action', { id, their_words: 'yes' }), /expired/, 'a yes cannot be reused');

    assert.match(await call('place_order', { item: 'peanut butter' }), /promised never/);
    home.vendor.setSubstitute('oat-milk-6', 'almond-milk-6'); // out of stock: store swaps in a tree-nut product
    assert.match(await call('place_order', { item: 'oat milk' }), /tree nuts/);
    home.vendor.setSubstitute('oat-milk-6', null);
    assert.strictEqual(home.sent.length, 2);

    // Store changes the price between the yes and the charge: blocked, nothing charged.
    const fry = await call('place_order', { item: 'air fryer' });
    assert.match(fry, /\$89\.99/);
    home.vendor.setPrice('air-fryer', 10999);
    assert.match(await call('confirm_action', { id: fry.match(/with id ([0-9a-f]+)/)[1], their_words: 'yes' }), /stopped before paying/);
    assert.strictEqual(home.sent.length, 2);

    assert.match(await call('change_promise', { ask_first_amount: '500' }), /sent that to the person who runs your home/);
    assert.match(await call('read_promises'), /\$75\.00/, 'loosening not applied by the assistant');
    assert.strictEqual((await fetch(base + '/owner/pending')).status, 401);
    const pend = await (await fetch(base + '/owner/pending', { headers: { 'x-owner-key': 'owner-secret' } })).json();
    const ok = await (await fetch(base + '/owner/approve/' + pend[0].id, { method: 'POST', headers: { 'x-owner-key': 'owner-secret' } })).json();
    assert.strictEqual(ok.status, 'applied'); assert.match(await call('read_promises'), /\$500\.00/);

    assert.match(await call('change_promise', { ask_first_amount: '40' }), /Done\..*\$40\.00/, 'stricter change applies directly');
    assert.match(await call('what_did_you_do'), /order 5/);
    assert.ok(home.log.verify().ok);
  } finally { await client.close(); srv.close(); }
});

test('restart keeps the promises; a tampered promises file refuses to start', async () => {
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hcrs-'));
  const a = createApp({ dataDir, ownerKey: 'k' });
  a.home.setup('family', { spendConfirmCents: '60' });
  const r = a.home.gate.proposeAmendment({ spendConfirmCents: 4000 }, { source: 'user-utterance' });
  a.home.gate.confirmAmendment(r.pendingId, { said: 'yes', speaker: 'p', source: 'user-utterance' });
  const b = createApp({ dataDir, ownerKey: 'k' });
  assert.strictEqual(b.home.gate.constitution.version, 2);
  assert.strictEqual(b.home.gate.constitution.params.spendConfirmCents, 4000);
  const f = path.join(dataDir, 'household.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"spendConfirmCents": 4000', '"spendConfirmCents": 900000'));
  assert.throws(() => createApp({ dataDir, ownerKey: 'k' }), /altered/);
});
