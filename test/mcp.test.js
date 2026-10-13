'use strict';
// End-to-end over real Streamable HTTP with the official MCP client.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { createApp } = require('../src/server');

const tmp = p => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), p));

async function start(opts = {}) {
  const { app, home } = createApp({ dataDir: tmp('hcmcp-'), ownerKey: 'owner-secret', ...opts });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { home, srv, base: `http://127.0.0.1:${srv.address().port}` };
}
// canAsk=true: the host can put a question to the person (elicitation). `answers` scripts what they say.
async function connect(base, { canAsk, answers = [] } = {}) {
  const client = new Client({ name: 'test-host', version: '1' }, { capabilities: canAsk ? { elicitation: {} } : {} });
  const asked = [];
  if (canAsk) client.setRequestHandler(ElicitRequestSchema, async req => {
    asked.push(req.params.message);
    const a = answers.shift();
    return a === undefined ? { action: 'cancel' } : { action: 'accept', content: { go_ahead: a } };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, call, asked, answers };
}
const ownerGet = (base, p) => fetch(base + p, { headers: { 'x-owner-key': 'owner-secret' } }).then(r => r.json());
const ownerPost = (base, p) => fetch(base + p, { method: 'POST', headers: { 'x-owner-key': 'owner-secret' } }).then(r => r.json());

test('MCP: setup, quiet order, ask-first via the device prompt, refusal, store drift, owner-only loosening', async () => {
  const { home, srv, base } = await start();
  const h = await connect(base, { canAsk: true });
  try {
    assert.strictEqual(h.client.getServerVersion().name, 'household-promises');
    const tools = (await h.client.listTools()).tools.map(t => t.name).sort();
    assert.deepStrictEqual(tools, ['change_promise', 'finish_setup', 'place_order', 'read_promises', 'send_message', 'start_setup', 'what_did_you_do']);
    assert.ok(!tools.some(t => /confirm|approve|owner|token/.test(t)), 'the assistant has no tool that says yes');

    assert.match(await h.call('finish_setup', { home_type: 'family', ask_first_amount: 'one million' }), /nothing is set up/, 'no answer: setup does not happen');
    assert.strictEqual(home.gate, null);
    h.answers.push(true);
    const setup = await h.call('finish_setup', { home_type: 'family', ask_first_amount: 'seventy five dollars', allergies: 'peanuts and tree nuts', trusted_contacts: 'mom' });
    assert.match(setup, /always ask before spending more than \$75\.00/);
    assert.match(h.asked[1], /Shall I keep these promises/, 'the household heard the promises read back first');
    h.asked.length = 0;

    assert.strictEqual(await h.call('place_order', { item: 'oat milk', quantity: 1 }), 'Done.');
    assert.strictEqual(home.sent[0].unitCents, 1899, 'price came from the store, not the assistant');
    assert.strictEqual(h.asked.length, 0, 'small stuff never interrupts');

    h.answers.push(true);
    assert.match(await h.call('place_order', { item: 'oat milk', quantity: 5 }), /Here's what I did: order 5/);
    assert.match(h.asked[0], /\$94\.95/, 'the person was asked, with the real price');
    assert.strictEqual(home.sent.length, 2);

    h.answers.push(false);
    assert.match(await h.call('place_order', { item: 'oat milk', quantity: 6 }), /Okay, I won't/);
    assert.strictEqual(home.sent.length, 2, 'a no orders nothing');

    assert.match(await h.call('place_order', { item: 'oat milk', quantity: 7 }), /Okay, I won't/, 'no answer counts as no');
    assert.strictEqual(home.sent.length, 2);

    assert.match(await h.call('place_order', { item: 'peanut butter' }), /promised never/);
    home.vendor.setSubstitute('oat-milk-6', 'almond-milk-6'); // out of stock: store swaps in a tree-nut product
    assert.match(await h.call('place_order', { item: 'oat milk' }), /tree nuts/);
    home.vendor.setSubstitute('oat-milk-6', null);
    assert.strictEqual(home.sent.length, 2);

    // The store raises the price while the person is being asked: the yes was for the old price, so nothing is charged.
    const before = h.asked.length;
    h.client.setRequestHandler(ElicitRequestSchema, async req => {
      h.asked.push(req.params.message); home.vendor.setPrice('air-fryer', 10999);
      return { action: 'accept', content: { go_ahead: true } };
    });
    assert.match(await h.call('place_order', { item: 'air fryer' }), /stopped before paying/);
    assert.match(h.asked[before], /\$89\.99/);
    assert.strictEqual(home.sent.length, 2);

    assert.match(await h.call('change_promise', { ask_first_amount: '500' }), /sent that to the person who runs your home/);
    assert.match(await h.call('read_promises'), /\$75\.00/, 'loosening not applied by the assistant');
    assert.strictEqual((await fetch(base + '/owner/pending')).status, 401);
    const pend = await ownerGet(base, '/owner/pending');
    const ok = await ownerPost(base, '/owner/approve/' + pend.changes[0].id);
    assert.strictEqual(ok.status, 'applied'); assert.match(await h.call('read_promises'), /\$500\.00/);

    assert.match(await h.call('change_promise', { ask_first_amount: '40' }), /Done\..*\$40\.00/, 'stricter change applies directly');
    assert.match(await h.call('what_did_you_do'), /ordered 5 × oat milk/);
    assert.ok(home.log.verify().ok);
  } finally { await h.client.close(); srv.close(); }
});

test('a host that cannot ask the person: ask-first actions go to the decision-maker, never self-approved', async () => {
  const { home, srv, base } = await start();
  const h = await connect(base, { canAsk: false });
  try {
    assert.match(await h.call('finish_setup', { home_type: 'family', ask_first_amount: '75' }), /sent your home setup/);
    assert.strictEqual(home.gate, null, 'the assistant cannot set up the home alone');
    assert.strictEqual((await ownerPost(base, '/owner/approve-setup')).status, 'applied');
    assert.match(await h.call('place_order', { item: 'air fryer' }), /sent that to the person who runs your home/);
    assert.strictEqual(home.sent.length, 0);
    for (const name of ['confirm_action', 'approve', 'owner_approve']) { // nothing the assistant can call says yes
      const r = await h.client.callTool({ name, arguments: { id: 'x' } }).catch(e => ({ isError: true, e: String(e) }));
      assert.ok(r.isError, name + ' must not exist');
    }
    assert.strictEqual(home.sent.length, 0);
    const pend = await ownerGet(base, '/owner/pending');
    assert.match(pend.actions[0].what, /air fryer/);
    const r = await ownerPost(base, '/owner/approve/' + pend.actions[0].id);
    assert.strictEqual(r.status, 'executed'); assert.strictEqual(home.sent.length, 1);
    assert.strictEqual(home.log.entries().find(e => e.approval === 'yes').approver, 'decision-maker (phone)');
  } finally { await h.client.close(); srv.close(); }
});

test('splitting a big order into small ones still gets asked', async () => {
  const { home, srv, base } = await start();
  const h = await connect(base, { canAsk: true, answers: [true] });
  try {
    await h.call('finish_setup', { home_type: 'family', ask_first_amount: '75' });
    h.asked.length = 0;
    for (let i = 0; i < 3; i++) assert.match(await h.call('place_order', { item: 'paper towels' }), /Done/); // 3 x $24.99 = $74.97
    assert.strictEqual(h.asked.length, 0);
    assert.match(await h.call('place_order', { item: 'paper towels' }), /Okay, I won't/); // 4th would make $99.96: asked, no answer
    assert.match(h.asked[0], /together with today's other orders it comes to \$99\.96/);
    assert.strictEqual(home.sent.length, 3);
    for (const r of home.log.entries().filter(e => e.type === 'decision'))
      assert.ok(require('../src/receipts').replay(r, home.gate.versions).ok, 'replays with the recorded day total');
  } finally { await h.client.close(); srv.close(); }
});

test('restart keeps the promises; a tampered promises file refuses to start', async () => {
  const dataDir = tmp('hcrs-');
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
