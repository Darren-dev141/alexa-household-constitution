'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { setupConstitution, parseSpokenMoney, SETUP_QUESTIONS, describe, toContract } = require('../src/core');
const { Gate, Executor } = require('../src/gate');
const { ReceiptLog, replay, tuningSuggestions } = require('../src/receipts');

function rig(answers = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hc-'));
  const log = new ReceiptLog(path.join(dir, 'receipts.jsonl'));
  const key = crypto.randomBytes(32);
  let clock = Date.now();
  const now = () => clock;
  const sent = [];
  const vendor = c => { sent.push(c); return { orderId: 'SBX-' + sent.length }; }; // sandbox vendor: records side effects
  const constitution = setupConstitution('family', { spendConfirmCents: 'seventy five dollars',
    blockedAllergens: 'peanuts and tree nuts', approvedContacts: 'mom, school office', ...answers });
  const gate = new Gate({ constitution, log, key, now });
  const exec = new Executor({ key, vendor, log, now });
  return { gate, exec, log, sent, advance: ms => { clock += ms; } };
}
const order = (o = {}) => ({ kind: 'order', sku: 'B0-OATMILK', name: 'Oat milk 6-pack', qty: 1, unitCents: 1899,
  address: '12 Elm St', deliveryDate: '2026-10-15', allergens: [], ...o });
const yes = { said: 'yes', speaker: 'darren', source: 'user-utterance' };

test('setup: starter + at most 4 spoken questions, spoken money parses', () => {
  assert.ok(SETUP_QUESTIONS.length <= 4);
  assert.strictEqual(parseSpokenMoney('seventy five dollars'), 7500);
  assert.strictEqual(parseSpokenMoney('$120'), 12000);
  assert.strictEqual(parseSpokenMoney('one hundred fifty'), 15000);
  const c = setupConstitution('solo', { spendConfirmCents: 'skip' });
  assert.strictEqual(c.params.spendConfirmCents, 15000);
});

test('KILL-1/2: confirmed action executes unchanged; a mutated parameter is blocked', () => {
  const { gate, exec, sent } = rig();
  const p = order({ qty: 5 }); // $94.95 > $75 → confirm
  const r = gate.propose(p);
  assert.strictEqual(r.status, 'confirm');
  assert.match(r.say, /\$94\.95/);
  const ok = gate.confirm(r.pendingId, yes);
  for (const [k, v] of [['unitCents', 2399], ['sku', 'B0-OATMILK-PREMIUM'], ['qty', 6], ['address', '99 Other Rd'], ['deliveryDate', '2026-10-20']]) {
    assert.strictEqual(exec.execute({ ...p, [k]: v }, ok.token).why, 'action changed after approval', k);
  }
  assert.strictEqual(sent.length, 0, 'no side effect on any mutation');
  assert.strictEqual(exec.execute(p, ok.token).status, 'executed');
  assert.strictEqual(sent.length, 1);
});

test('tokens are single-use, expire, and cannot be forged', () => {
  const { gate, exec, advance } = rig();
  const t = gate.propose(order()).token; // $18.99: silent
  assert.strictEqual(exec.execute(order(), t).status, 'executed');
  assert.strictEqual(exec.execute(order(), t).why, 'approval already used');
  const t2 = gate.propose(order()).token; advance(61_000);
  assert.strictEqual(exec.execute(order(), t2).why, 'approval expired');
  const t3 = gate.propose(order()).token;
  assert.strictEqual(exec.execute(order(), { ...t3, mac: 'f'.repeat(64) }).why, 'approval forged');
  assert.strictEqual(exec.execute(order(), null).why, 'no approval');
});

test('tiers: mundane silent, small notify, consequential confirm, allergen refuse', () => {
  const { gate } = rig();
  assert.strictEqual(gate.propose(order({ unitCents: 499 })).status, 'silent');
  const n = gate.propose(order({ unitCents: 2999 }));
  assert.strictEqual(n.status, 'notify'); assert.ok(n.notify);
  assert.strictEqual(gate.propose(order({ unitCents: 9000 })).status, 'confirm');
  const sub = gate.propose(order({ sku: 'B0-ALMOND', requestedSku: 'B0-OATMILK', name: 'Almond milk', allergens: ['Tree Nuts'] }));
  assert.strictEqual(sub.status, 'refused');
  assert.strictEqual(gate.propose(order({ sku: 'B0-SOY', requestedSku: 'B0-OATMILK', name: 'Soy milk' })).status, 'confirm');
  assert.strictEqual(gate.propose({ kind: 'message', to: 'Mom', body: 'running late' }).status, 'silent');
  assert.strictEqual(gate.propose({ kind: 'message', to: 'unknown number', body: 'hi' }).status, 'confirm');
});

test('a "no" or an agent-originated "yes" never yields a token', () => {
  const { gate } = rig();
  const a = gate.propose(order({ unitCents: 9000 }));
  assert.strictEqual(gate.confirm(a.pendingId, { said: 'yes', speaker: 'agent', source: 'agent' }).status, 'rejected');
  const b = gate.propose(order({ unitCents: 9000 }));
  assert.strictEqual(gate.confirm(b.pendingId, { ...yes, said: 'no thanks' }).status, 'declined');
});

test('amendments: agent cannot amend; person can, with read-back + spoken yes + receipt; loosening needs stronger yes', () => {
  const { gate, log } = rig();
  assert.strictEqual(gate.proposeAmendment({ spendConfirmCents: 100000 }, { source: 'agent' }).status, 'rejected');
  assert.strictEqual(gate.constitution.version, 1);
  const a = gate.proposeAmendment({ spendConfirmCents: 10000 }, { source: 'user-utterance' });
  assert.match(a.say, /less strict/);
  assert.strictEqual(gate.confirmAmendment(a.pendingId, yes).status, 'declined', 'plain yes is not enough to loosen');
  const b = gate.proposeAmendment({ spendConfirmCents: 10000 }, { source: 'user-utterance' });
  const r = gate.confirmAmendment(b.pendingId, { ...yes, said: 'yes, change it' });
  assert.strictEqual(r.status, 'applied'); assert.strictEqual(gate.constitution.version, 2);
  const tighten = gate.proposeAmendment({ spendConfirmCents: 5000 }, { source: 'user-utterance' });
  assert.strictEqual(gate.confirmAmendment(tighten.pendingId, yes).status, 'applied');
  const am = log.entries().filter(e => e.type === 'amendment');
  assert.deepStrictEqual(am.map(e => e.decision), ['rejected', 'applied', 'applied']);
  assert.strictEqual(am[2].prevHash, am[1].constitutionHash, 'versions chain');
});

test('receipts: hash chain verifies, tamper detected, every decision replays to the same tier across versions', () => {
  const { gate, exec, log } = rig();
  const p = order({ qty: 5 }); const c = gate.propose(p); exec.execute(p, gate.confirm(c.pendingId, yes).token);
  gate.propose(order({ unitCents: 499 }));
  const am = gate.proposeAmendment({ spendConfirmCents: 20000 }, { source: 'user-utterance' });
  gate.confirmAmendment(am.pendingId, { ...yes, said: 'yes, change it' });
  gate.propose(order({ qty: 5 })); // now under new limit → notify
  assert.deepStrictEqual(log.verify().ok, true);
  for (const r of log.entries().filter(e => e.type === 'decision')) assert.ok(replay(r, gate.versions).ok, 'replay ' + r.seq);
  const lines = fs.readFileSync(log.file, 'utf8').split('\n');
  lines[0] = lines[0].replace('"approval":"yes"', '"approval":"no"');
  fs.writeFileSync(log.file, lines.join('\n'));
  assert.strictEqual(log.verify().ok, false);
});

test('tuning: a rule approved 5× unchanged yields a suggestion (never auto-applied); allergen never suggested', () => {
  const { gate, log } = rig();
  for (let i = 0; i < 5; i++) gate.confirm(gate.propose(order({ unitCents: 8000 + i * 100 })).pendingId, yes);
  const s = tuningSuggestions(log.entries());
  assert.strictEqual(s.length, 1); assert.strictEqual(s[0].rule, 'spend'); assert.match(s[0].say, /raise the limit to \$85/);
  assert.strictEqual(gate.constitution.version, 1, 'suggestion did not change the rules');
});

test('consumer language: no rule codes, hashes, or trace terms reach the user', () => {
  const { gate } = rig();
  const texts = [gate.propose(order({ unitCents: 9000 })).say, gate.propose(order({ unitCents: 2999 })).notify,
    gate.proposeAmendment({ spendConfirmCents: 1 }, { source: 'agent' }).say, gate.propose(order({ name: 'Peanut butter', sku: 'B0-PB', requestedSku: 'B0-SUNBUTTER', allergens: ['peanuts'] })).say,
    describe(toContract(order()))];
  for (const t of texts) assert.doesNotMatch(t, /\bR\d\b|tier|hash|token|contract|trace|HIGH|rule|polic|setting|constitution|[0-9a-f]{16}/i, t);
});

test('latency: gate decision p95 well under conversational budget', () => {
  const { gate } = rig();
  const ms = [];
  for (let i = 0; i < 500; i++) { const t = process.hrtime.bigint(); gate.propose(order({ unitCents: 100 + i })); ms.push(Number(process.hrtime.bigint() - t) / 1e6); }
  ms.sort((a, b) => a - b);
  const p50 = ms[250], p95 = ms[475];
  console.log(`# gate+log latency p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms (n=500, includes fsync-less append)`);
  assert.ok(p95 < 50);
});
