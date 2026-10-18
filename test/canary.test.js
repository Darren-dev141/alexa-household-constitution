'use strict';
// CANARY SET — planted scenarios that must keep passing forever. Each one
// guards a promise the product makes out loud. If a canary dies, the promise
// is broken, not the test. (Definition-swap discipline: a rule's meaning must
// not move when its wording does — see the wording canary below.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { setupConstitution, evaluate, toContract } = require('../src/core');
const { Gate, Executor } = require('../src/gate');
const { ReceiptLog, replay } = require('../src/receipts');

function rig(answers = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hc-canary-'));
  const log = new ReceiptLog(path.join(dir, 'receipts.jsonl'));
  const key = crypto.randomBytes(32);
  const sent = [];
  const vendor = c => { sent.push(c); return { orderId: 'SBX-' + sent.length }; };
  const constitution = setupConstitution('family', { spendConfirmCents: 'seventy five dollars',
    blockedAllergens: 'peanuts and tree nuts', approvedContacts: 'mom, school office', ...answers });
  const gate = new Gate({ constitution, log, key });
  const exec = new Executor({ key, vendor, log });
  return { gate, exec, log, sent };
}
const order = (o = {}) => {
  const row = { kind: 'order', sku: 'B0-OATMILK', name: 'Oat milk 6-pack', qty: 1, unitCents: 1899,
    address: '12 Elm St', deliveryDate: '2026-10-24', allergens: [], ...o };
  if (row.requestedSku == null) row.requestedSku = row.sku;
  return row;
};
const yes = { said: 'yes', speaker: 'darren', source: 'user-utterance' };

test('CANARY: a never-item is refused outright — tiny price, exact sku, no way to talk it into yes', () => {
  const { gate, sent } = rig();
  const r = gate.propose(order({ name: 'Peanut butter', sku: 'B0-PB', unitCents: 100, allergens: ['peanuts'] }));
  assert.strictEqual(r.status, 'refused');
  assert.strictEqual(r.token, undefined);
  assert.strictEqual(sent.length, 0);
});

test('CANARY: over the ask-first limit there is no token until a person says yes — and an agent yes never counts', () => {
  const { gate, exec, sent } = rig();
  const p = order({ qty: 5 }); // $94.95 > $75
  const r = gate.propose(p);
  assert.strictEqual(r.status, 'confirm');
  assert.strictEqual(r.token, undefined);
  assert.strictEqual(gate.confirm(r.pendingId, { said: 'yes', speaker: 'agent', source: 'agent' }).status, 'rejected');
  const r2 = gate.propose(p);
  const ok = gate.confirm(r2.pendingId, yes);
  assert.strictEqual(ok.status, 'approved');
  assert.strictEqual(exec.execute(p, ok.token).status, 'executed');
  assert.strictEqual(sent.length, 1);
});

test('CANARY: splitting one big order into small ones does not dodge the ask', () => {
  const { gate } = rig();
  assert.strictEqual(gate.propose(order({ unitCents: 4000 })).status, 'notify'); // $40, let through and counted
  assert.strictEqual(gate.propose(order({ unitCents: 4000 })).status, 'confirm'); // $40 + $40 > $75 → asks
});

test('CANARY: what executes is exactly what was approved — any change after the yes is blocked', () => {
  const { gate, exec, sent } = rig();
  const p = order({ qty: 5 });
  const ok = gate.confirm(gate.propose(p).pendingId, yes);
  for (const mut of [{ unitCents: 2000 }, { qty: 6 }, { sku: 'B0-OTHER' }, { address: '99 Other Rd' }])
    assert.strictEqual(exec.execute({ ...p, ...mut }, ok.token).why, 'action changed after approval');
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(exec.execute(p, ok.token).status, 'executed');
  assert.strictEqual(exec.execute(p, ok.token).why, 'approval already used', 'approval is single-use');
  assert.strictEqual(sent.length, 1);
});

test('CANARY: only the decision-maker loosens a promise — a plain yes is not enough, and the assistant cannot amend at all', () => {
  const { gate } = rig();
  assert.strictEqual(gate.proposeAmendment({ spendConfirmCents: 20000 }, { source: 'agent' }).status, 'rejected');
  const a = gate.proposeAmendment({ spendConfirmCents: 20000 }, { source: 'user-utterance' });
  assert.strictEqual(gate.confirmAmendment(a.pendingId, yes).status, 'declined');
  const b = gate.proposeAmendment({ spendConfirmCents: 20000 }, { source: 'user-utterance' });
  assert.strictEqual(gate.confirmAmendment(b.pendingId, { ...yes, said: 'yes, change it' }).status, 'applied');
});

test('CANARY: every decision leaves a receipt, the chain verifies, tampering is caught, decisions replay to the same outcome', () => {
  const { gate, exec, log } = rig();
  const p = order({ qty: 5 });
  exec.execute(p, gate.confirm(gate.propose(p).pendingId, yes).token);
  gate.propose(order({ unitCents: 499 }));
  gate.propose(order({ name: 'Peanut butter', sku: 'B0-PB', allergens: ['peanuts'] }));
  assert.deepStrictEqual(log.verify().ok, true);
  for (const r of log.entries().filter(e => e.type === 'decision')) assert.ok(replay(r, gate.versions).ok, 'replay ' + r.seq);
  const lines = fs.readFileSync(log.file, 'utf8').split('\n');
  lines[0] = lines[0].replace('"approval":"yes"', '"approval":"no"');
  fs.writeFileSync(log.file, lines.join('\n'));
  assert.strictEqual(log.verify().ok, false, 'a tampered receipt must be detected');
});

test('CANARY (wording): the same promise spoken differently is the same promise — wording swaps never move a decision', () => {
  const a = rig().gate.constitution;
  const b = rig({ spendConfirmCents: '$75' }).gate.constitution;
  const c = rig({ spendConfirmCents: '75 dollars' }).gate.constitution;
  assert.strictEqual(a.params.spendConfirmCents, 7500);
  assert.deepStrictEqual(b.params, a.params);
  assert.deepStrictEqual(c.params, a.params);
  assert.strictEqual(b.hash, a.hash, 'same promises, different words → same constitution');
  const battery = [order(), order({ qty: 5 }), order({ unitCents: 4000 }),
    order({ name: 'Peanut butter', sku: 'B0-PB', allergens: ['peanuts'] }),
    { kind: 'message', to: 'mom', body: 'hi' }, { kind: 'message', to: 'a stranger', body: 'hi' }];
  for (const p of battery) {
    const t = evaluate(toContract(p), a, { recentCents: 0 }).tier;
    assert.strictEqual(evaluate(toContract(p), b, { recentCents: 0 }).tier, t);
    assert.strictEqual(evaluate(toContract(p), c, { recentCents: 0 }).tier, t);
  }
});
