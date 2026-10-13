'use strict';
// Live mode for recording: the real server on this machine, fresh data, and a host that
// CANNOT ask the person, so setup and the big order wait on the parent's phone page (/owner),
// decided by hand in a real browser. Simulated: the Alexa+ host, the voice, the store.
//   node demo/live.js            (optional: PORT=3000 DEMO_PACE_MS=1500 OWNER_KEY=...)
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { createApp } = require('../src/server');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runLive({ port = 0, ownerKey, paceMs = 0, waitForOwner, log = console.log, waitLimitMs = 10 * 60_000 } = {}) {
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hclive-'));
  const { app, home } = createApp({ dataDir, ownerKey });
  const srv = await new Promise(r => { const s = app.listen(port, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const say = async (who, t) => { log(`${who.padEnd(10)} ${t}`); if (paceMs) await sleep(paceMs); };
  const client = new Client({ name: 'simulated-alexa-host', version: '0.1' }); // no elicitation: cannot ask the person
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args, line) => {
    if (line) await say('Household', line);
    const r = (await client.callTool({ name, arguments: args })).content[0].text;
    await say('Assistant', r);
    return r;
  };
  // Wait until the parent has decided on the phone page (or the hook decides, in tests).
  const decided = async (done, what) => {
    await say('Waiting', `for the parent to decide on ${base}/owner (${what})`);
    if (waitForOwner) await waitForOwner(what, base);
    const t0 = Date.now();
    while (!done()) { if (Date.now() - t0 > waitLimitMs) throw new Error('no decision on ' + what); await sleep(250); }
  };
  const result = { base, home };
  try {
    await say('Note', 'Simulated Alexa+ host and voice. Sandbox store, not a real merchant. Real server, real checks, real receipts.');
    await call('finish_setup', { home_type: 'family', ask_first_amount: 'seventy five dollars', allergies: 'peanuts' },
      "We're a family. Ask before anything over seventy-five dollars. No peanuts, ever.");
    await decided(() => !home.pendingSetup, 'home setup');
    result.setUp = !!home.gate;
    if (!result.setUp) { await say('Assistant', "Okay, nothing is set up."); return result; }
    await call('read_promises', {}, 'What will you promise us?');
    await call('place_order', { item: 'dish soap', quantity: 1 }, 'We need dish soap.');
    await call('place_order', { item: 'air fryer', quantity: 1 }, 'Order the air fryer.');
    await decided(() => home.heldActions.size === 0, 'air fryer');
    result.airFryerOrdered = home.sent.some(o => /air fryer/.test(o.name));
    await say('Store', result.airFryerOrdered ? 'The air fryer was ordered after the parent said okay.' : 'Parent said no. Nothing was ordered.');
    await call('what_did_you_do', {}, 'What did you do today?');
    result.orders = home.sent.map(o => `${o.qty} × ${o.name}`);
    result.chainOk = home.log.verify().ok;
    await say('Receipts', `${home.log.entries().length} entries, chain ${result.chainOk ? 'intact' : 'BROKEN'}.`);
    return result;
  } finally { await client.close(); srv.close(); }
}

if (require.main === module) {
  const ownerKey = process.env.OWNER_KEY || crypto.randomBytes(9).toString('base64url');
  const port = Number(process.env.PORT || 3000);
  // Recording: set OWNER_KEY beforehand so the code never appears on screen.
  console.log(`Parent's page: http://127.0.0.1:${port}/owner   home code: ${process.env.OWNER_KEY ? '(from OWNER_KEY, not shown)' : ownerKey + '   (set OWNER_KEY to keep it off screen)'}\n`);
  runLive({ port, ownerKey, paceMs: Number(process.env.DEMO_PACE_MS || 1500) })
    .then(r => { console.log('\nLIVE DEMO DONE', JSON.stringify({ setUp: r.setUp, airFryerOrdered: r.airFryerOrdered, orders: r.orders, chainOk: r.chainOk })); })
    .catch(e => { console.error('LIVE DEMO FAILED:', e.message); process.exitCode = 1; });
}
module.exports = { runLive };
