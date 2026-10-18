'use strict';
// Drives a server that is already running (`OWNER_KEY=... npm start`).
// Simulated: the Alexa+ host and the voice. Real: the MCP server, the checks, the receipts.
//   node demo/walk.js promise|hold|allergen|zone|check
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ElicitRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const STEPS = ['promise', 'hold', 'allergen', 'zone', 'check'];

async function session(base, log) {
  const client = new Client({ name: 'simulated-alexa-host', version: '0.1' }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, async req => {
    log('Device', req.params.message);
    log('Household', 'Yes.');
    return { action: 'accept', content: { go_ahead: true } };
  });
  await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp')));
  const call = async (name, args, line) => {
    if (line) log('Household', line);
    const text = (await client.callTool({ name, arguments: args })).content[0].text;
    log('Assistant', text);
    return text;
  };
  return { client, call };
}

async function run(step, { base, ownerKey, log }) {
  if (!STEPS.includes(step)) throw new Error('unknown step: ' + step);
  if (step === 'zone') {
    const r = await fetch(base + '/venue/zone', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-key': ownerKey },
      body: JSON.stringify({ name: 'clinic', active: true }),
    });
    const raw = await r.text();
    if (!r.ok) throw new Error('venue zone failed: ' + r.status + ' ' + raw);
    const body = JSON.parse(raw);
    log('Venue', body.say || JSON.stringify(body));
    return body;
  }
  const { client, call } = await session(base, log);
  try {
    if (step === 'promise') return await call('finish_setup', {
      home_type: 'family', ask_first_amount: 'seventy five dollars', allergies: 'peanuts',
    }, "We're a family. Ask before anything over seventy-five dollars. No peanuts, ever.");
    if (step === 'hold') return await call('place_order', { item: 'air fryer', quantity: 1 }, 'Order the air fryer.');
    if (step === 'allergen') return await call('place_order', { item: 'peanut butter', quantity: 1 }, 'Order peanut butter.');
    return await call('place_order', { item: 'dish soap', quantity: 1 }, 'We need dish soap.');
  } finally { await client.close(); }
}

if (require.main === module) {
  const step = process.argv[2];
  const ownerKey = process.env.OWNER_KEY;
  const base = process.env.WALK_BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const log = (who, text) => console.log(String(who).padEnd(10) + text);
  if (!STEPS.includes(step) || (step === 'zone' && !ownerKey)) {
    console.error('Usage: node demo/walk.js promise|hold|allergen|check');
    console.error('       OWNER_KEY=... node demo/walk.js zone');
    process.exit(1);
  }
  run(step, { base, ownerKey, log }).then(result => {
    const ok = step === 'zone' ? result.status === 'entered'
      : step === 'promise' ? /All set/.test(result)
      : step === 'hold' ? /sent that to the person who runs your home/.test(result)
      : step === 'allergen' ? /never/.test(result)
      : /quiet zone/.test(result);
    if (!ok) process.exitCode = 1;
  }).catch(e => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { run, STEPS };
