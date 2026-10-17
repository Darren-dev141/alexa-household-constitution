'use strict';
// Quiet Zones (Portable Constitution, venue-side) — prototype slice.
// A zone pauses every gated action; the pause and every zone change are
// receipted; a venue-set zone cannot be lifted from inside the home.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { setupConstitution } = require('../src/core');
const { Gate, Executor } = require('../src/gate');
const { ReceiptLog } = require('../src/receipts');

function rig() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hc-zone-'));
  const log = new ReceiptLog(path.join(dir, 'receipts.jsonl'));
  const key = crypto.randomBytes(32);
  const sent = [];
  const vendor = c => { sent.push(c); return { orderId: 'SBX-' + sent.length }; };
  const constitution = setupConstitution('family', { spendConfirmCents: 'seventy five dollars',
    blockedAllergens: 'peanuts', approvedContacts: 'mom' });
  const gate = new Gate({ constitution, log, key });
  const exec = new Executor({ key, vendor, log });
  return { gate, exec, log, sent };
}
const order = (o = {}) => ({ kind: 'order', sku: 'B0-SOAP', name: 'Dish soap', qty: 1, unitCents: 399,
  address: '12 Elm St', deliveryDate: '2026-10-24', allergens: [], ...o });

test('zone: a venue quiet zone holds even a tiny order — no token, no side effect, hold is receipted', () => {
  const { gate, exec, log, sent } = rig();
  assert.strictEqual(gate.zoneEvent({ name: 'Clinic', active: true, source: 'venue-signal' }).status, 'entered');
  const r = gate.propose(order());
  assert.strictEqual(r.status, 'held');
  assert.strictEqual(r.token, undefined);
  assert.strictEqual(sent.length, 0);
  const holds = log.entries().filter(e => e.type === 'zone' && e.decision === 'held');
  assert.strictEqual(holds.length, 1);
  assert.strictEqual(holds[0].zone, 'clinic');
  assert.strictEqual(holds[0].setBy, 'venue');
});

test('zone: the household cannot lift a venue zone early; the attempt is receipted; the venue signal can end it', () => {
  const { gate, log } = rig();
  gate.zoneEvent({ name: 'clinic', active: true, source: 'venue-signal' });
  const try1 = gate.zoneEvent({ name: 'clinic', active: false, source: 'user-utterance' });
  assert.strictEqual(try1.status, 'rejected');
  assert.strictEqual(gate.zones.size, 1, 'zone still active after household exit attempt');
  assert.strictEqual(gate.propose(order()).status, 'held');
  assert.strictEqual(gate.zoneEvent({ name: 'clinic', active: false, source: 'venue-signal' }).status, 'exited');
  assert.strictEqual(gate.propose(order()).status, 'silent', 'actions flow again after the venue ends the zone');
  const zs = log.entries().filter(e => e.type === 'zone').map(e => e.decision);
  assert.deepStrictEqual(zs, ['entered', 'exit-rejected', 'held', 'exited']);
  assert.deepStrictEqual(log.verify().ok, true);
});

test('zone: a household-set zone can be lifted by the household; the assistant can never set or lift a zone', () => {
  const { gate } = rig();
  assert.strictEqual(gate.zoneEvent({ name: 'movie night', active: true, source: 'agent' }).status, 'rejected');
  assert.strictEqual(gate.zones.size, 0);
  gate.zoneEvent({ name: 'movie night', active: true, source: 'user-utterance' });
  assert.strictEqual(gate.propose(order()).status, 'held');
  assert.strictEqual(gate.zoneEvent({ name: 'movie night', active: false, source: 'user-utterance' }).status, 'exited');
  assert.strictEqual(gate.propose(order()).status, 'silent');
});
