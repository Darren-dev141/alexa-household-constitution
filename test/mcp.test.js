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

    const setup = await call('finish_setup', { home_type: 'family', ask_first_amount: 'seventy five dollars', allergies: 'peanuts', trusted_contacts: 'mom' });
    assert.match(setup, /always ask before spending more than \$75\.00/);

    const o = { sku: 'oat', name: 'Oat milk', qty: 1, unit_cents: 499, address: '12 Elm', delivery_date: '2026-10-15' };
    assert.strictEqual(await call('place_order', o), 'Done.');
    assert.strictEqual(home.sent.length, 1);

    const ask = await call('place_order', { ...o, qty: 20 });
    assert.match(ask, /\$99\.80/); assert.strictEqual(home.sent.length, 1, 'nothing ordered before yes');
    const id = ask.match(/with id ([0-9a-f]+)/)[1];
    assert.match(await call('confirm_action', { id, their_words: 'yes' }), /Here's what I did: order 20/);
    assert.strictEqual(home.sent.length, 2);
    assert.match(await call('confirm_action', { id, their_words: 'yes' }), /expired/, 'a yes cannot be reused');

    assert.match(await call('place_order', { ...o, sku: 'pb', requested_sku: 'oat', name: 'Peanut butter', allergens: ['peanuts'] }), /never bring that|promised never/);
    assert.strictEqual(home.sent.length, 2);

    assert.match(await call('change_promise', { ask_first_amount: '500' }), /sent that to the person who runs your home/);
    assert.match(await call('read_promises'), /\$75\.00/, 'loosening not applied by the assistant');
    assert.strictEqual((await fetch(base + '/owner/pending')).status, 401);
    const pend = await (await fetch(base + '/owner/pending', { headers: { 'x-owner-key': 'owner-secret' } })).json();
    const ok = await (await fetch(base + '/owner/approve/' + pend[0].id, { method: 'POST', headers: { 'x-owner-key': 'owner-secret' } })).json();
    assert.strictEqual(ok.status, 'applied'); assert.match(await call('read_promises'), /\$500\.00/);

    assert.match(await call('change_promise', { ask_first_amount: '40' }), /Done\..*\$40\.00/, 'stricter change applies directly');
    assert.match(await call('what_did_you_do'), /order 20/);
    assert.ok(home.log.verify().ok);
  } finally { await client.close(); srv.close(); }
});
