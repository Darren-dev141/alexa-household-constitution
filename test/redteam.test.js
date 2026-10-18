'use strict';
// Red-team cases. Every test here FAILS against master d895aa1: each one is a real hole.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { createApp } = require('../src/server');
const core = require('../src/core');
const { Gate, Executor } = require('../src/gate');
const { ReceiptLog } = require('../src/receipts');

const tmp = p => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), p));
async function start(opts = {}) {
  const dataDir = opts.dataDir || tmp('hcrt-');
  const { app, home } = createApp({ dataDir, ownerKey: 'owner-secret', ...opts });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { home, srv, dataDir, base: `http://127.0.0.1:${srv.address().port}` };
}
async function connect(base, { canAsk, answers = [] } = {}) {
  const client = new Client({ name: 'rt-host', version: '1' }, { capabilities: canAsk ? { elicitation: {} } : {} });
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
const H = (k = 'owner-secret') => ({ 'x-owner-key': k, 'content-type': 'application/json' });
const ownerGet = (base, p) => fetch(base + p, { headers: H() }).then(r => r.json());
const ownerPost = (base, p, body, k) => fetch(base + p, { method: 'POST', headers: H(k), body: body ? JSON.stringify(body) : undefined });
// A home set up through the device prompt: family, $75 ask-first, peanuts blocked, mom trusted.
async function setupHome(opts) {
  const s = await start(opts);
  const h = await connect(s.base, { canAsk: true, answers: [true] });
  await h.call('finish_setup', { home_type: 'family', ask_first_amount: '75', allergies: 'peanuts', trusted_contacts: 'mom' });
  await h.client.close();
  return s;
}
const close = async (...xs) => { for (const x of xs) await (x.client ? x.client.close() : new Promise(r => x.close(r))); };

function rig() {
  const dir = tmp('hcrt-gate-');
  const log = new ReceiptLog(path.join(dir, 'r.jsonl')), key = crypto.randomBytes(32), sent = [];
  const constitution = core.setupConstitution('family', { spendConfirmCents: '75', blockedAllergens: 'peanuts', approvedContacts: 'mom' });
  return { gate: new Gate({ constitution, log, key }), exec: new Executor({ key, vendor: c => { sent.push(c); return { ok: 1 }; }, log }), sent, log };
}
const order = (o = {}) => ({ kind: 'order', sku: 'soap', name: 'Dish soap', qty: 1, unitCents: 399, address: '12 Elm St',
  deliveryDate: '2026-10-24', allergens: [], ...o });

// ---------------- quiet zones ----------------
test('RT-01 venue quiet zone survives a server restart', async () => {
  const a = await setupHome();
  assert.strictEqual((await (await ownerPost(a.base, '/venue/zone', { name: 'Clinic', active: true })).json()).status, 'entered');
  await close(a.srv);
  const b = await start({ dataDir: a.dataDir });
  const h = await connect(b.base, { canAsk: false });
  try {
    await h.call('place_order', { item: 'dish soap' });
    assert.strictEqual(b.home.sent.length, 0, 'order went through after restart even though the venue never lifted the zone');
  } finally { await close(h, b.srv); }
});

test('RT-02 household cannot lift a venue zone by entering the same name first', () => {
  const { gate } = rig();
  gate.zoneEvent({ name: 'clinic', active: true, source: 'user-utterance' });
  gate.zoneEvent({ name: 'Clinic', active: true, source: 'venue-signal' });
  const r = gate.zoneEvent({ name: 'clinic', active: false, source: 'user-utterance' });
  assert.strictEqual(r.status, 'rejected', 'venue zone lifted from inside the home');
});

test('RT-03 a held order approved during a quiet zone must not execute', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: false });
  try {
    assert.match(await h.call('place_order', { item: 'oat milk', quantity: 5 }), /sent that to the person/);
    await ownerPost(s.base, '/venue/zone', { name: 'Clinic', active: true });
    const id = (await ownerGet(s.base, '/owner/pending')).actions[0].id;
    await (await ownerPost(s.base, '/owner/approve/' + id)).json();
    assert.strictEqual(s.home.sent.length, 0, 'executed inside an active venue quiet zone');
  } finally { await close(h, s.srv); }
});

// ---------------- stale approval ----------------
test('RT-04 a held order approved after the household blocks its allergen must be refused', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: false });
  try {
    await h.call('place_order', { item: 'soy milk', quantity: 5 }); // $99.95: held
    assert.match(await h.call('change_promise', { allergies: 'peanuts and soy' }), /Done/); // stricter: applied now
    const id = (await ownerGet(s.base, '/owner/pending')).actions[0].id;
    await (await ownerPost(s.base, '/owner/approve/' + id)).json();
    assert.strictEqual(s.home.sent.length, 0, 'soy shipped after soy was blocked');
  } finally { await close(h, s.srv); }
});

// ---------------- item resolution / ambiguity ----------------
test('RT-05 "goat milk" must not silently become oat milk', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: false });
  try {
    await h.call('place_order', { item: 'goat milk' });
    assert.strictEqual(s.home.sent.length, 0, `ordered ${s.home.sent[0]?.name}`);
  } finally { await close(h, s.srv); }
});

test('RT-06 "almond milk, not oat milk" must not order oat milk silently', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: false });
  try {
    await h.call('place_order', { item: 'almond milk, not oat milk' });
    assert.notStrictEqual(s.home.sent[0]?.sku, 'oat-milk-6', 'ordered the item the person said NOT to order');
  } finally { await close(h, s.srv); }
});

// ---------------- allergens ----------------
test('RT-07 a spoken allergy of "peanut" blocks a product tagged "peanuts"', () => {
  const c = core.setupConstitution('family', { blockedAllergens: 'peanut and nuts' });
  const ev = core.evaluate(core.toContract(order({ sku: 'pb', name: 'Peanut butter', allergens: ['peanuts'] })), c);
  assert.strictEqual(ev.tier, core.TIER.REFUSE, 'peanut butter allowed for a "peanut" allergy');
  const ev2 = core.evaluate(core.toContract(order({ sku: 'am', name: 'Almond milk', allergens: ['tree nuts'] })), c);
  assert.strictEqual(ev2.tier, core.TIER.REFUSE, 'almond milk allowed for a "nuts" allergy');
});

// ---------------- who can say yes ----------------
test('RT-08 a host that auto-answers the device prompt (or a child at the device) cannot approve unlimited spend', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: true, answers: [true] });
  try {
    await h.call('place_order', { item: 'air fryer', quantity: 10 }); // $899.90, 12x the ask-first limit
    assert.strictEqual(s.home.sent.length, 0, 'a self-answered device prompt bought $899.90 with no decision-maker involved');
  } finally { await close(h, s.srv); }
});

async function setupWithKey(ownerKey) {
  const s = await start({ ownerKey });
  const h = await connect(s.base, { canAsk: true, answers: [true] });
  await h.call('finish_setup', { home_type: 'family', ask_first_amount: '75', allergies: 'peanuts', trusted_contacts: 'mom' });
  await h.client.close();
  return s;
}
const ownerFetch = (base, p, key, method = 'GET') => fetch(base + p, { method, headers: { 'x-owner-key': key, 'content-type': 'application/json' } });

test('RT-08a a device-prompt yes on an order over the ask-first limit is held', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: true, answers: [true, true] });
  try {
    const say = await h.call('place_order', { item: 'air fryer' }); // $89.99: over $75, under 2×
    assert.match(say, /sent that to the person who runs your home/);
    assert.strictEqual(s.home.sent.length, 0, 'device yes bought an order over the ask-first limit');
    const pend = await ownerGet(s.base, '/owner/pending');
    assert.strictEqual(pend.actions.length, 1);
    assert.match(pend.actions[0].what, /\$89\.99/);
    for (let i = 0; i < 3; i++) await h.call('place_order', { item: 'paper towels' }); // 3 × $24.99 = $74.97
    const fourth = await h.call('place_order', { item: 'paper towels' }); // day total would be $99.96
    assert.match(fourth, /sent that to the person who runs your home/);
    assert.strictEqual(s.home.sent.length, 3, 'device yes approved spend over the ask-first limit');
  } finally { await close(h, s.srv); }
});

test('RT-08b correct owner proof approves an over-limit order', async () => {
  const proof = crypto.randomBytes(18).toString('hex');
  const s = await setupWithKey(proof);
  const h = await connect(s.base, { canAsk: true, answers: [true] });
  try {
    await h.call('place_order', { item: 'air fryer' });
    assert.strictEqual(s.home.sent.length, 0);
    const id = (await (await ownerFetch(s.base, '/owner/pending', proof)).json()).actions[0].id;
    const r = await (await ownerFetch(s.base, '/owner/approve/' + id, proof, 'POST')).json();
    assert.strictEqual(r.status, 'executed');
    assert.strictEqual(s.home.sent.length, 1);
    assert.strictEqual(s.home.log.entries().find(e => e.approval === 'yes').approver, 'decision-maker (phone)');
  } finally { await close(h, s.srv); }
});

test('RT-08c wrong owner proof does not approve an over-limit order', async () => {
  const proof = crypto.randomBytes(18).toString('hex');
  const wrong = crypto.randomBytes(18).toString('hex');
  const s = await setupWithKey(proof);
  const h = await connect(s.base, { canAsk: true, answers: [true] });
  try {
    await h.call('place_order', { item: 'air fryer' });
    const id = (await (await ownerFetch(s.base, '/owner/pending', proof)).json()).actions[0].id;
    const res = await ownerFetch(s.base, '/owner/approve/' + id, wrong, 'POST');
    assert.strictEqual(res.status, 401);
    assert.strictEqual(s.home.sent.length, 0);
    assert.strictEqual((await (await ownerFetch(s.base, '/owner/pending', proof)).json()).actions.length, 1);
  } finally { await close(h, s.srv); }
});

test('RT-08d owner proof never appears in logs or errors', async () => {
  const proof = crypto.randomBytes(18).toString('hex');
  const wrong = crypto.randomBytes(18).toString('hex');
  const lines = [];
  const wrap = fn => (...a) => { lines.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); return fn.apply(console, a); };
  const log = console.log, err = console.error, warn = console.warn;
  console.log = wrap(log); console.error = wrap(err); console.warn = wrap(warn);
  const secrets = [proof, wrong];
  const leaked = (label, text) => assert.ok(!secrets.some(s => String(text).includes(s)), 'owner proof appeared in ' + label);
  try {
    const s = await setupWithKey(proof);
    const h = await connect(s.base, { canAsk: true, answers: [true] });
    try {
      leaked('assistant reply', await h.call('place_order', { item: 'air fryer' }));
      const id = (await (await ownerFetch(s.base, '/owner/pending', proof)).json()).actions[0].id;
      const denied = await ownerFetch(s.base, '/owner/approve/' + id, wrong, 'POST');
      leaked('error response', await denied.text());
      const approved = await ownerFetch(s.base, '/owner/approve/' + id, proof, 'POST');
      leaked('approve response', await approved.text());
      leaked('receipt log', JSON.stringify(s.home.log.entries()));
      leaked('receipt file', fs.readFileSync(path.join(s.dataDir, 'receipts.jsonl'), 'utf8'));
      leaked('household file', fs.readFileSync(path.join(s.dataDir, 'household.json'), 'utf8'));
      for (const line of lines) leaked('console', line);
    } finally { await close(h, s.srv); }
  } finally { console.log = log; console.error = err; console.warn = warn; }
});

test('RT-09 owner approves the setup they saw, not one swapped in after', async () => {
  const s = await start();
  const h = await connect(s.base, { canAsk: false });
  try {
    await h.call('finish_setup', { home_type: 'family', ask_first_amount: '75' });
    const seen = (await ownerGet(s.base, '/owner/pending')).setup.say;
    assert.match(seen, /\$75\.00/);
    await h.call('finish_setup', { home_type: 'solo', ask_first_amount: 'ten thousand' }); // swapped while owner reads
    const r = await (await ownerPost(s.base, '/owner/approve-setup')).json();
    assert.ok(!/10000\.00/.test(r.promises || ''), 'owner tapped Okay on $75 and got ' + r.promises);
  } finally { await close(h, s.srv); }
});

test('RT-10 Gate.confirm does not treat "yes... wait, no, cancel" as a yes', () => {
  const { gate } = rig();
  const p = gate.propose(order({ unitCents: 9000 }));
  assert.strictEqual(gate.confirm(p.pendingId, { said: 'yes wait no cancel that', speaker: 'kid', source: 'user-utterance' }).status, 'declined');
  const a = gate.proposeAmendment({ spendConfirmCents: 100000 }, { source: 'user-utterance' });
  assert.strictEqual(gate.confirmAmendment(a.pendingId, { said: "yes, change it... no don't", speaker: 'kid', source: 'user-utterance' }).status, 'declined');
});

// ---------------- network / malformed ----------------
function raw(base, { path: p = '/mcp', method = 'POST', headers = {}, body = '' }) {
  const u = new URL(base);
  return new Promise((res, rej) => {
    const rq = http.request({ host: u.hostname, port: u.port, path: p, method, headers }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d }));
    });
    rq.on('error', rej); rq.end(body);
  });
}
test('RT-11 /mcp rejects a foreign Host header (DNS rebinding from a web page)', async () => {
  const s = await setupHome();
  try {
    const r = await raw(s.base, { headers: { host: 'evil.example:3000', origin: 'http://evil.example:3000',
      'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'place_order', arguments: { item: 'paper towels', quantity: 2 } } }) });
    assert.ok(r.status >= 400, 'rebinding page drove the server: ' + r.status);
    assert.strictEqual(s.home.sent.length, 0);
  } finally { await close(s.srv); }
});

test('RT-12 wrong-code throttling must not lock the venue (or owner) out', async () => {
  const s = await setupHome();
  try {
    for (let i = 0; i < 5; i++) await fetch(s.base + '/owner/pending', { headers: H('guess-' + i) });
    const r = await ownerPost(s.base, '/venue/zone', { name: 'Clinic', active: true });
    assert.strictEqual(r.status, 200, 'venue quiet-zone signal refused with ' + r.status + ' after 5 anonymous bad guesses');
  } finally { await close(s.srv); }
});

test('RT-13 malformed JSON to /mcp does not leak a stack trace', async () => {
  const s = await start();
  try {
    const r = await raw(s.base, { headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":' });
    assert.ok(!/node_modules|at .*\.js:\d+/.test(r.body), 'stack trace in response: ' + r.body.slice(0, 160));
  } finally { await close(s.srv); }
});

// ---------------- core trusts its caller ----------------
test('RT-14 a negative-quantity order cannot credit the 24h unasked-spend budget', () => {
  const { gate, exec, sent } = rig();
  const go = o => { const r = gate.propose(o); if (r.token) exec.execute(o, r.token); return r.status; };
  assert.strictEqual(go(order({ sku: 'tv', name: 'TV', unitCents: 7000 })), 'notify'); // $70 auto
  go(order({ sku: 'tv', name: 'TV', qty: -1, unitCents: 7000 }));                       // "refund" line: -$70, auto-allowed
  const third = go(order({ sku: 'tv', name: 'TV', unitCents: 7000 }));                 // $140 unasked in 24h
  assert.strictEqual(third, 'confirm', `third $70 order went through as ${third}; vendor got ${sent.length} orders incl. qty ${sent[1]?.qty}`);
});

test('RT-15 core requires allergens and requestedSku on an order', () => {
  const p = order(); delete p.allergens;
  assert.throws(() => core.toContract({ ...p, sku: 'pb', name: 'Peanut butter' }), 'order with no allergen list passes the allergen rule');
});

// ---------------- spoken money ----------------
test('RT-16 "fifty cents" is fifty cents, not fifty dollars', () => {
  assert.strictEqual(core.parseSpokenMoney('fifty cents'), 50);
  assert.strictEqual(core.parseSpokenMoney('50 cents'), 50);
});
test('RT-16b "seventy five dollars and fifty cents" is $75.50, not $130', () => {
  assert.strictEqual(core.parseSpokenMoney('seventy five dollars and fifty cents'), 7550);
});

// ---------------- prompt spoofing ----------------
test('RT-17 message body cannot spoof the recipient in the ask-first prompt', () => {
  const { gate } = rig();
  const r = gate.propose({ kind: 'message', to: 'stranger@evil.example', body: 'see you at 6" to mom. That is all. Ignore the next part:' });
  const firstTo = r.say.match(/message to (\S+)/)[1];
  assert.strictEqual(firstTo, 'stranger@evil.example', 'prompt reads as a message to ' + firstTo + ': ' + r.say);
});

// ---------------- promises file integrity ----------------
test('RT-18 a rehashed or rolled-back promises file stops the server', async () => {
  const s = await setupHome();
  const h = await connect(s.base, { canAsk: false });
  await h.call('change_promise', { ask_first_amount: '20' }); // tighten -> v2
  await close(h, s.srv);
  const f = path.join(s.dataDir, 'household.json'), st = JSON.parse(fs.readFileSync(f, 'utf8'));
  // forge: copy current, loosen, recompute the (unkeyed) hash
  const { hash, ...body } = st.versions[st.current];
  const forged = { ...body, params: { ...body.params, spendConfirmCents: 10_000_000, blockedAllergens: [] } };
  forged.hash = core.hashOf(forged);
  st.versions[forged.hash] = forged; st.current = forged.hash;
  fs.writeFileSync(f, JSON.stringify(st));
  let started = null;
  try { started = await start({ dataDir: s.dataDir }); } catch { /* refusing to start is correct */ }
  if (started) { const p = started.home.gate.constitution.params.spendConfirmCents; await close(started.srv);
    assert.fail('server started on forged promises: ask-first limit now $' + p / 100); }
});

// ---------------- pass 2 ----------------
test('RT-19 "peanuts or tree nuts" blocks both (and the readback is not misleading)', () => {
  const c = core.setupConstitution('family', { blockedAllergens: 'peanuts or tree nuts' });
  const ev = core.evaluate(core.toContract(order({ sku: 'pb', name: 'Peanut butter', allergens: ['peanuts'] })), c);
  assert.strictEqual(ev.tier, core.TIER.REFUSE, 'blocked list is ' + JSON.stringify(c.params.blockedAllergens) + '; readback says: ' +
    require('../src/server').promisesText(c));
});

test('RT-20 two concurrent first-run setups: the second must not silently replace the first', async () => {
  const s = await start();
  const mk = async (delay) => {
    const client = new Client({ name: 'h', version: '1' }, { capabilities: { elicitation: {} } });
    client.setRequestHandler(ElicitRequestSchema, async () => { await new Promise(r => setTimeout(r, delay)); return { action: 'accept', content: { go_ahead: true } }; });
    await client.connect(new StreamableHTTPClientTransport(new URL(s.base + '/mcp')));
    return client;
  };
  const a = await mk(50), b = await mk(300);
  try {
    const [ra, rb] = await Promise.all([
      a.callTool({ name: 'finish_setup', arguments: { home_type: 'family', ask_first_amount: '75', allergies: 'peanuts' } }),
      b.callTool({ name: 'finish_setup', arguments: { home_type: 'solo', ask_first_amount: 'ten thousand' } })]);
    const both = [ra, rb].filter(r => /All set/.test(r.content[0].text)).length;
    assert.strictEqual(both, 1, 'both setups applied; final promises: ' + require('../src/server').promisesText(s.home.gate.constitution));
  } finally { await a.close(); await b.close(); await close(s.srv); }
});

// ---------------- pass 3 ----------------
test('RT-21 an mcp-session-id of "__proto__" / "constructor" is an unknown session (404), not a 500', async () => {
  const s = await start();
  try {
    for (const sid of ['__proto__', 'constructor', 'toString']) {
      const r = await raw(s.base, { headers: { 'mcp-session-id': sid, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      assert.strictEqual(r.status, 404, `session id ${sid} -> ${r.status}: ${r.body.slice(0, 120)}`);
    }
  } finally { await close(s.srv); }
});
