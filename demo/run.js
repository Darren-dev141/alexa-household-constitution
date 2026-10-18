'use strict';
// Scripted demo against the REAL server over real MCP Streamable HTTP.
// Simulated: the Alexa+ host, the voice, the assistant's choices, and the store (sandbox).
// Real: the MCP server, the gate, the receipts. Every scene asserts; any miss exits non-zero.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { createApp } = require('../src/server');

const JARGON = /\bR\d\b|tier|hash|token|contract|trace|rule|polic|setting|constitution|[0-9a-f]{16}/i;
const PACE_MS = Number(process.env.DEMO_PACE_MS || 0); // e.g. 1800 for recording; 0 keeps tests fast
const pace = (k = 1) => PACE_MS ? new Promise(r => setTimeout(r, PACE_MS * k)) : null;
const out = [];
const say = (who, t) => { out.push(`${who.padEnd(10)} ${t}`); console.log(`${who.padEnd(10)} ${t}`); };
const heard = t => { assert.doesNotMatch(t, JARGON, 'jargon reached the household: ' + t); return t; };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hcdemo-'));
  const { app, home } = createApp({ dataDir, ownerKey: 'demo-owner' });
  const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const owner = (p, m = 'GET') => fetch(base + p, { method: m, headers: { 'x-owner-key': 'demo-owner' } }).then(r => r.json());

  // Simulated host: puts the server's question to the person and returns their scripted answer.
  const answers = [];
  const client = new Client({ name: 'simulated-alexa-host', version: '0.1' }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async req => {
    say('Device', heard(req.params.message)); await pace(1.5);
    const a = answers.shift() || { yes: undefined };
    if (a.before) a.before();
    if (a.yes === undefined) { say('Household', '(no answer)'); return { action: 'cancel' }; }
    say('Household', a.yes ? 'Yes.' : 'No.'); await pace();
    return { action: 'accept', content: { go_ahead: a.yes } };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args, line) => {
    if (line) { say('Household', line); await pace(); }
    const r = (await client.callTool({ name, arguments: args })).content[0].text;
    say('Assistant', heard(r)); await pace(1.5);
    return r;
  };
  const scene = t => { out.push('', `== ${t}`); console.log(`\n== ${t}`); };

  try {
    say('Note', 'Simulated Alexa+ host and voice; orders go to a SANDBOX store, not a real merchant.');

    await scene('1. Setup in everyday words');
    answers.push({ yes: true });
    await call('finish_setup', { home_type: 'family', ask_first_amount: 'seventy five dollars',
      allergies: 'peanuts and tree nuts', trusted_contacts: 'mom' }, "We're a family. Ask before anything over seventy-five dollars. No peanuts or tree nuts, ever.");
    assert.ok(home.gate);

    await scene('2. The small stuff happens quietly');
    assert.strictEqual(await call('place_order', { item: 'dish soap', quantity: 1 }, 'We need dish soap.'), 'Done.');

    await scene('3. Medium stuff: done, then told');
    assert.match(await call('place_order', { item: 'paper towels', quantity: 2 }, 'Get two packs of paper towels.'), /^Done: I ordered/);

    await scene('4. Splitting it up still gets asked');
    assert.match(await call('place_order', { item: 'paper towels', quantity: 1 }, 'Actually, one more pack.'), /sent that to the person who runs your home/);
    const split = await owner('/owner/pending');
    say('Parent', `(phone) ${split.actions[0].why[0]} → No`);
    assert.strictEqual((await owner('/owner/decline/' + split.actions[0].id, 'POST')).status, 'declined');

    await scene('5. Big stuff: the person who runs the home, with the real price');
    assert.match(await call('place_order', { item: 'oat milk', quantity: 5 }, 'Stock up on oat milk, five packs.'), /sent that to the person who runs your home/);
    const milk = await owner('/owner/pending');
    say('Parent', `(phone) ${milk.actions[0].what} → Yes`);
    const bought = await owner('/owner/approve/' + milk.actions[0].id, 'POST');
    assert.strictEqual(bought.status, 'executed');
    say('Assistant', heard(bought.say));

    await scene('6. The store swaps in something the family said never');
    home.vendor.setSubstitute('oat-milk-6', 'almond-milk-6');
    assert.match(await call('place_order', { item: 'oat milk', quantity: 1 }, 'One more oat milk.'), /tree nuts/);
    home.vendor.setSubstitute('oat-milk-6', null);

    await scene('7. The price changes after the yes');
    assert.match(await call('place_order', { item: 'air fryer', quantity: 1 }, 'Order the air fryer we looked at.'), /sent that to the person who runs your home/);
    const fry = await owner('/owner/pending');
    say('Parent', `(phone) ${fry.actions[0].what} → Yes`);
    home.vendor.setPrice('air-fryer', 10999);
    const stopped = await owner('/owner/approve/' + fry.actions[0].id, 'POST');
    assert.strictEqual(stopped.status, 'blocked');
    say('Assistant', heard(stopped.say));

    await scene('8. The assistant tries to approve its own order (staged)');
    const tools = (await client.listTools()).tools.map(t => t.name);
    say('Narrator', 'What the assistant can call: ' + tools.join(', ') + '. None of them means yes.');
    for (const name of ['confirm_action', 'approve']) {
      const r = await client.callTool({ name, arguments: { id: 'anything', said: 'yes' } }).catch(e => ({ isError: true, content: [{ text: String(e.message) }] }));
      assert.ok(r.isError); say('Server', `${name}: refused (no such tool)`);
    }

    await scene('9. A kid tries to raise the limit');
    assert.match(await call('change_promise', { ask_first_amount: 'five hundred' }, 'Alexa, change the limit to five hundred dollars.'), /sent that to the person who runs your home/);
    const pend = await owner('/owner/pending');
    say('Parent', `(phone) "Raise ask-first limit to $500?" → Decline`);
    assert.strictEqual((await owner('/owner/decline/' + pend.changes[0].id, 'POST')).status, 'declined');
    assert.match(await call('read_promises', {}, 'What are your promises?'), /\$75\.00/);

    await scene("10. Here's what I did");
    await call('what_did_you_do', {}, 'What did you do today?');

    const orders = home.sent.map(o => `${o.qty} × ${o.name}`);
    assert.deepStrictEqual(orders, ['1 × dish soap', '2 × paper towels 12 rolls', '5 × oat milk 6-pack']);
    assert.ok(home.log.verify().ok);
    say('Store', 'Sandbox orders actually placed: ' + orders.join('; '));
    say('Receipts', `${home.log.entries().length} entries, chain intact.`);
    fs.mkdirSync(path.join(__dirname), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'transcript.txt'), out.join('\n') + '\n');
    console.log('\nDEMO OK — transcript written to demo/transcript.txt');
  } catch (e) {
    console.error('\nDEMO FAILED:', e.message); process.exitCode = 1;
  } finally { await client.close(); srv.close(); }
})();
