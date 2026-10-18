'use strict';
// The submission demo, against a server that is already running (the same
// routes as `OWNER_KEY=... npm start`). Four beats: a promise set by voice,
// an over-limit order approved on the owner page, a blocked allergen, and a
// quiet zone that still holds after a restart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createApp } = require('../src/server');
const { run } = require('../demo/walk');

const tmp = () => fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hcwalk-'));
const listen = app => new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const KEY = 'home-demo-code';

test('walk: voice promise, owner-approved air fryer, blocked peanut butter, quiet zone after restart', async () => {
  const dataDir = tmp();
  const lines = [];
  const log = (who, text) => lines.push(who + ' ' + text);
  const a = createApp({ dataDir, ownerKey: KEY });
  const srv = await listen(a.app);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const opts = { base, ownerKey: KEY, log };
  try {
    const setup = await run('promise', opts);
    assert.match(setup, /All set/);
    assert.match(setup, /always ask before spending more than \$75\.00/);
    assert.match(setup, /never bring peanuts/);
    assert.ok(lines.some(l => /^Device /.test(l) && /Shall I keep these promises/.test(l)), 'the household heard the promises read back');

    const held = await run('hold', opts);
    assert.match(held, /sent that to the person who runs your home/);
    assert.strictEqual(a.home.sent.length, 0, 'the air fryer was not ordered before the owner page');
    const pend = await fetch(base + '/owner/pending', { headers: { 'x-owner-key': KEY } }).then(r => r.json());
    assert.match(pend.actions[0].what, /air fryer for \$89\.99/);
    const approved = await fetch(base + '/owner/approve/' + pend.actions[0].id, {
      method: 'POST', headers: { 'x-owner-key': KEY },
    }).then(r => r.json());
    assert.strictEqual(approved.status, 'executed');
    assert.strictEqual(a.home.sent.length, 1);

    const blocked = await run('allergen', opts);
    assert.match(blocked, /peanut/);
    assert.match(blocked, /never/);
    assert.strictEqual(a.home.sent.length, 1, 'the allergen was not ordered');

    const zone = await run('zone', opts);
    assert.strictEqual(zone.status, 'entered');
    assert.strictEqual(zone.zone, 'clinic');
  } finally { await new Promise(r => srv.close(r)); }

  const b = createApp({ dataDir, ownerKey: KEY });
  const srv2 = await listen(b.app);
  const base2 = `http://127.0.0.1:${srv2.address().port}`;
  try {
    const pending = await fetch(base2 + '/owner/pending', { headers: { 'x-owner-key': KEY } }).then(r => r.json());
    assert.ok(pending.zones.some(z => z.name === 'clinic' && z.setBy === 'venue'), 'quiet zone missing after restart');
    const again = await run('check', { base: base2, ownerKey: KEY, log });
    assert.match(again, /quiet zone/);
    assert.strictEqual(b.home.sent.length, 0, 'dish soap was ordered inside the quiet zone');
  } finally { await new Promise(r => srv2.close(r)); }
});
