'use strict';
// Guest Mode: while the decision-maker has it on, a guest session can only
// order what is on the guest list, inside the household's own limits — no
// messages, no substitutions, nothing that would need an okay — and it turns
// itself off. All of it is enforced in the gate, receipted like everything else.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { setupConstitution } = require('../src/core');
const { Gate, Executor, guestText } = require('../src/gate');
const { ReceiptLog } = require('../src/receipts');
const { createApp } = require('../src/server');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

function rig() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hc-guest-'));
  const log = new ReceiptLog(path.join(dir, 'receipts.jsonl'));
  const key = crypto.randomBytes(32);
  let clock = Date.now();
  const now = () => clock;
  const sent = [];
  const vendor = c => { sent.push(c); return { orderId: 'SBX-' + sent.length }; };
  const constitution = setupConstitution('family', { spendConfirmCents: 'seventy five dollars',
    blockedAllergens: 'peanuts', approvedContacts: 'mom' });
  const gate = new Gate({ constitution, log, key, now });
  const exec = new Executor({ key, vendor, log, now });
  return { gate, exec, log, sent, advance: ms => { clock += ms; } };
}
const order = (o = {}) => {
  const row = { kind: 'order', sku: 'dish-soap', name: 'Dish soap', qty: 1, unitCents: 399,
    address: '12 Elm St', deliveryDate: '2026-10-24', allergens: [], ...o };
  if (row.requestedSku == null) row.requestedSku = row.sku;
  return row;
};
const GUEST = { actor: 'guest' };
const on = (gate, allow, durationMs) => gate.guestEvent({ active: true, allow, durationMs, source: 'owner' });

test('guest: an allowed order passes through the normal tiers and executes; the receipt says it was a guest', () => {
  const { gate, exec, log, sent } = rig();
  assert.strictEqual(on(gate, ['Dish soap', 'paper-towels-12']).status, 'on');
  const quiet = gate.propose(order(), GUEST); // $3.99 — silent tier
  assert.strictEqual(quiet.status, 'silent');
  assert.strictEqual(exec.execute(order(), quiet.token).status, 'executed');
  const told = gate.propose(order({ sku: 'paper-towels-12', name: 'Paper towels 12 rolls', unitCents: 2499 }), GUEST);
  assert.strictEqual(told.status, 'notify', 'over the tell-me-after limit still notifies — friction tiers preserved');
  assert.strictEqual(exec.execute(order({ sku: 'paper-towels-12', name: 'Paper towels 12 rolls', unitCents: 2499 }), told.token).status, 'executed');
  assert.strictEqual(sent.length, 2);
  const ds = log.entries().filter(e => e.type === 'decision');
  assert.ok(ds.length >= 2 && ds.every(e => e.guest === true && e.decision === 'allowed'));
  assert.deepStrictEqual(log.verify().ok, true);
});

test('guest: everything not allowed is refused at the gate — no token, no pending, no side effect', () => {
  const { gate, log, sent } = rig();
  on(gate, ['dish soap', 'air-fryer', 'peanut-butter', 'almond-milk-6']);
  const cases = [
    [{ kind: 'message', to: 'mom', body: 'hi' }, /Guests can't send messages/],
    [order({ sku: 'oat-milk-6', name: 'Oat milk 6-pack', unitCents: 1899 }), /isn't on the list/],
    [order({ sku: 'almond-milk-6', name: 'Almond milk 6-pack', unitCents: 1799, allergens: ['tree nuts'], requestedSku: 'oat-milk-6' }), /no swaps/],
    [order({ sku: 'air-fryer', name: 'Air fryer', unitCents: 8999 }), /needs an okay/],
    [order({ sku: 'peanut-butter', name: 'Peanut butter', unitCents: 549, allergens: ['peanuts'] }), /never to bring that into your home/],
  ];
  for (const [p, say] of cases) {
    const r = gate.propose(p, GUEST);
    assert.strictEqual(r.status, 'refused', JSON.stringify(p));
    assert.match(r.say, say);
    assert.strictEqual(r.token, undefined);
  }
  assert.strictEqual(gate.pending.size, 0, 'a guest never creates something a person could approve');
  assert.strictEqual(sent.length, 0);
  const refusals = log.entries().filter(e => e.type === 'decision' && e.guest && e.decision === 'refused');
  assert.strictEqual(refusals.length, cases.length, 'every refusal is receipted');
});

test('guest: it expires on its own; after expiry a guest gets nothing and the household is unaffected', () => {
  const { gate, log, advance } = rig();
  on(gate, ['dish soap'], 60_000);
  assert.strictEqual(gate.propose(order(), GUEST).status, 'silent');
  advance(61_000);
  const r = gate.propose(order(), GUEST);
  assert.strictEqual(r.status, 'refused');
  assert.match(r.say, /Guest Mode isn't on/);
  assert.strictEqual(gate.guest, null);
  assert.ok(log.entries().some(e => e.type === 'guest' && e.decision === 'expired'), 'the expiry is receipted');
  assert.strictEqual(gate.propose(order()).status, 'silent', 'the household still flows');
});

test('guest: only the decision-maker can turn it on, off, or change the list — attempts are receipted', () => {
  const { gate, log } = rig();
  for (const source of ['user-utterance', 'agent', 'venue-signal']) {
    assert.strictEqual(gate.guestEvent({ active: true, allow: ['dish soap'], source }).status, 'rejected', source);
    assert.strictEqual(gate.guest, null);
  }
  assert.strictEqual(on(gate, ['dish soap']).status, 'on');
  assert.strictEqual(gate.guestEvent({ active: false, source: 'user-utterance' }).status, 'rejected');
  assert.ok(gate.guestActive(), 'a household voice cannot end it early either — decision-maker only');
  assert.strictEqual(gate.guestEvent({ active: false, source: 'owner' }).status, 'off');
  assert.deepStrictEqual(log.entries().filter(e => e.type === 'guest').map(e => e.decision),
    ['rejected', 'rejected', 'rejected', 'on', 'rejected', 'off']);
});

test('guest: off means off, and while it is on the household path is unchanged', () => {
  const { gate } = rig();
  assert.strictEqual(gate.propose(order(), GUEST).status, 'refused', 'no Guest Mode, no guest actions');
  on(gate, []); // on, but the list is empty: questions only
  assert.strictEqual(gate.propose(order(), GUEST).status, 'refused');
  const msg = { kind: 'message', to: 'mom', body: 'dinner at six' };
  assert.strictEqual(gate.propose(msg).status, 'silent', 'a member messaging an approved contact is untouched');
  assert.strictEqual(gate.propose(msg, GUEST).status, 'refused', 'the same message from a guest is refused');
  assert.match(guestText(gate.guestActive()), /Guests can't send messages/);
  assert.match(guestText(null), /Guest Mode is off/);
});

// ---------- server level: owner route + the guest flag on the tools ----------
const tmp = p => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), p));
async function start(dir) {
  const { app, home } = createApp({ dataDir: dir, ownerKey: 'owner-secret' });
  home.setup('family', { spendConfirmCents: 'seventy five dollars', blockedAllergens: 'peanuts', approvedContacts: 'mom' });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { home, srv, base: `http://127.0.0.1:${srv.address().port}` };
}
async function connect(base) {
  const client = new Client({ name: 'test-host', version: '1' }, { capabilities: {} });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args = {}) => (await client.callTool({ name, arguments: args })).content[0].text;
  return { client, call };
}
const guestPost = (base, body, key) => fetch(base + '/owner/guest', { method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'x-owner-key': key } : {}) }, body: JSON.stringify(body) });

test('guest over MCP: owner key turns it on; guests get the list and nothing else; off means off', async () => {
  const { home, srv, base } = await start(tmp('hcguest-'));
  const { client, call } = await connect(base);
  try {
    assert.strictEqual((await guestPost(base, { active: true, allow: ['dish soap'] })).status, 401, 'no key, no Guest Mode');
    assert.strictEqual(home.gate.guest, null);
    const onRes = await (await guestPost(base, { active: true, hours: 2, allow: ['dish soap'] }, 'owner-secret')).json();
    assert.strictEqual(onRes.status, 'on');
    assert.match(onRes.say, /a guest can ask me to order dish soap/);

    const pending = await fetch(base + '/owner/pending', { headers: { 'x-owner-key': 'owner-secret' } }).then(r => r.json());
    assert.deepStrictEqual(pending.guest.allow, ['dish soap'], 'the owner page shows Guest Mode');

    assert.strictEqual(await call('place_order', { item: 'dish soap', guest: true }), 'Done.');
    assert.strictEqual(home.sent.length, 1);
    assert.match(await call('place_order', { item: 'oat milk', guest: true }), /isn't on the list/);
    assert.match(await call('send_message', { to: 'mom', body: 'hi', guest: true }), /Guests can't send messages/);
    assert.strictEqual(home.sent.length, 1, 'nothing else happened');

    const gp = await call('read_promises', { guest: true });
    assert.match(gp, /While Guest Mode is on/);
    assert.ok(!/\$75\.00|mom/.test(gp), 'a guest never hears the household promises or contacts');
    assert.match(await call('what_did_you_do', { guest: true }), /people who live here/);
    assert.match(await call('read_promises', {}), /\$75\.00/, 'the household still hears its own promises');

    const offRes = await (await guestPost(base, { active: false }, 'owner-secret')).json();
    assert.strictEqual(offRes.status, 'off');
    assert.match(await call('place_order', { item: 'dish soap', guest: true }), /Guest Mode isn't on/);
  } finally { await client.close(); srv.close(); }
});

test('guest: the state survives a restart, like a quiet zone does', async () => {
  const dir = tmp('hcguest2-');
  const a = createApp({ dataDir: dir, ownerKey: 'owner-secret' });
  a.home.setup('family', { spendConfirmCents: 'seventy five dollars' });
  a.home.gate.guestEvent({ active: true, allow: ['dish soap'], durationMs: 3600_000, source: 'owner' });
  const b = createApp({ dataDir: dir, ownerKey: 'owner-secret' });
  const g = b.home.gate.guestActive();
  assert.ok(g, 'Guest Mode is still on after the restart');
  assert.deepStrictEqual(g.allow, ['dish soap']);
  assert.strictEqual(b.home.gate.propose(order(), GUEST).status, 'silent');
  assert.deepStrictEqual(b.home.log.verify().ok, true);
});
